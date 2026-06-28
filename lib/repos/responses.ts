// lib/repos/responses.ts
//
// Admin-side read helpers for the `responses` + `answers` tables.
//
// IMPORTANT: this is a NON-PII helper. Unlike invitations.ts / consent.ts /
// recordings.ts, it does NOT branch on current_admin_role() and has no
// redacted view — `responses` and `answers` are on the non-PII allow-list
// (repos/README.md, D31). RLS already serves identical rows to both owner
// and readonly admins (policies r_admins_select / a_admins_select), so
// there is nothing to redact here.
//
// The respondent's IDENTITY context (recipient name/email, consent signed
// name) is NOT read here — it comes from the role-branching invitations and
// consent repos, which serve the base table to owner and the redacted view
// to readonly. Keep that boundary: never join a PII base table into these
// reads (a PostgREST embed onto `invitations` would hand readonly the
// ciphertext, bypassing invitations_redacted).
//
// These helpers take the AUTHENTICATED server client (carries the admin
// JWT) so RLS applies — not the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { getRichAnswers, richAnswerIsAnswered } from "./answers";

type DbRow = Database["public"]["Tables"]["responses"]["Row"];

// responses.status is a TEXT CHECK ('active','withdrawn') — the DB enforces
// it but Supabase gen types widen it to string, so we narrow at the boundary
// (same pattern as tags.category in lib/repos/tags.ts).
export type ResponseStatus = "active" | "withdrawn";

export type ResponseRow = {
  id: string;
  invitationId: string;
  language: "en" | "ar";
  startedAt: string;
  submittedAt: string | null;
  durationMinutes: number | null;
  isLocked: boolean;
  status: ResponseStatus;
  withdrawnAt: string | null;
};

function rowToResponse(r: DbRow): ResponseRow {
  // language + status are narrowed via `as` because the DB CHECKs enforce
  // the value sets but Supabase gen types widen both to string.
  //
  // D82 — durationMinutes is now a RAW COLUMN PASSTHROUGH (always null in
  // practice; no write path anywhere in the codebase). The D81 Item 2
  // compute-on-read fallback was REMOVED because it used the wrong start
  // milestone: responses.started_at = consent-moment, which includes the
  // gap between consent and first answer-save (production showed
  // OFF-JOR-03 at 2911 min / 48.5 hours because the recipient consented
  // on Day 1 and submitted on Day 3).
  //
  // The corrected ACTIVE-engagement duration semantic uses
  // invitations.started_at (set guard-once by saveAnswer on first answer
  // upsert — see lib/actions/answers.ts) as the start milestone. That
  // computation is cross-table (response.submitted_at + invitation.
  // started_at) so it cannot live inside this single-row mapper. Pages
  // that have both contexts (list + detail) call
  // computeActiveDurationMinutes below explicitly using their existing
  // invitation data — no new queries needed.
  return {
    id: r.id,
    invitationId: r.invitation_id,
    language: r.language as "en" | "ar",
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    durationMinutes: r.duration_minutes,
    isLocked: r.is_locked,
    status: r.status as ResponseStatus,
    withdrawnAt: r.withdrawn_at,
  };
}

/**
 * D82 — ACTIVE engagement duration between first-answer-save and submit.
 *
 * Start milestone: `invitations.started_at` — set by
 * lib/actions/answers.ts:saveAnswer on the FIRST answer upsert, guarded
 * by `.eq("status", "opened")` so it fires exactly once per invitation.
 * This is the "first_answer_at" moment — the recipient actively started
 * typing answers, distinct from `responses.started_at` (consent-page
 * completion moment).
 *
 * End milestone: `responses.submitted_at` — submit completion.
 *
 * Returns null when EITHER milestone is missing (no fallback to
 * consent-moment per D82 lock — that's the broken semantic we're
 * replacing). An in-progress response shows null → em-dash. A submitted
 * response with no invitations.started_at (legacy / pre-Session-2b)
 * also shows null → em-dash, an honest signal.
 *
 * Clock-skew defense: `if (ms >= 0)` guard mirrors the same posture as
 * getDashboardData's average computation and D81 Item 2's now-removed
 * fallback. Negative deltas degrade to null rather than display a
 * misleading negative.
 */
export function computeActiveDurationMinutes(
  invitationStartedAt: string | null | undefined,
  responseSubmittedAt: string | null | undefined
): number | null {
  if (!invitationStartedAt || !responseSubmittedAt) return null;
  const ms =
    new Date(responseSubmittedAt).getTime() -
    new Date(invitationStartedAt).getTime();
  if (ms < 0) return null;
  return Math.round(ms / 60000);
}

/**
 * All responses (caller sorts). Non-PII; both roles.
 *
 * `options.hideWithdrawn` (default false) — when true, applies
 * `.eq("status", "active")` at the query layer. The DEFAULT is
 * UNFILTERED because this read is in the MUST-RETAIN classification
 * (D63 cross-cutting filter map): admin surfaces (list page + detail
 * page) need access to withdrawn rows so Sura can manage them and
 * supervisors can see the withdrawn marker. Filtering is opt-IN via
 * the page-level toggle (?withdrawn=show), not baked into the repo.
 */
export async function listResponses(
  supabase: SupabaseClient<Database>,
  options?: { hideWithdrawn?: boolean }
): Promise<ResponseRow[]> {
  let q = supabase
    .from("responses")
    .select("id, invitation_id, language, started_at, submitted_at, duration_minutes, is_locked, status, withdrawn_at")
    .order("started_at", { ascending: false });
  if (options?.hideWithdrawn) {
    q = q.eq("status", "active");
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToResponse);
}

/** Single response by id. Null if not found. Non-PII; both roles. */
export async function getResponse(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<ResponseRow | null> {
  const { data, error } = await supabase
    .from("responses")
    .select("id, invitation_id, language, started_at, submitted_at, duration_minutes, is_locked, status, withdrawn_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToResponse(data) : null;
}

/**
 * Answered-question count per response, for the list view. D106 — TYPE-AWARE
 * via the shared getRichAnswers keystone + richAnswerIsAnswered predicate
 * (free_text → non-empty text; choice → ≥1 selected option). Before D106 this
 * counted non-blank answer_text only, so a choice answer (answer_text = '')
 * never counted. Returns a Map keyed by response_id; responses with no
 * answered questions are simply absent (caller defaults to 0).
 */
export async function getAnswerCounts(
  supabase: SupabaseClient<Database>,
  responseIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (responseIds.length === 0) return counts;
  const rich = await getRichAnswers(supabase, responseIds);
  for (const [responseId, byQuestion] of rich) {
    let n = 0;
    for (const a of byQuestion.values()) if (richAnswerIsAnswered(a)) n += 1;
    if (n > 0) counts.set(responseId, n);
  }
  return counts;
}
