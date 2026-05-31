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

export type AnswerDetail = {
  questionId: string;
  answerText: string;
  wordCount: number;
};

function rowToResponse(r: DbRow): ResponseRow {
  // language + status are narrowed via `as` because the DB CHECKs enforce
  // the value sets but Supabase gen types widen both to string.
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
 * Non-empty answer count per response, for the list view. Counts only
 * answers whose text is non-blank (matches the questionnaire's notion of
 * "answered" — getAnsweredQuestionIds in answers.ts). Returns a Map keyed
 * by response_id; responses with no answers are simply absent (caller
 * defaults to 0).
 */
export async function getAnswerCounts(
  supabase: SupabaseClient<Database>,
  responseIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (responseIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("answers")
    .select("response_id, answer_text")
    .in("response_id", responseIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row.answer_text ?? "").trim().length > 0) {
      counts.set(row.response_id, (counts.get(row.response_id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * All answers for one response, keyed by question_id, for the detail view.
 * Includes the generated word_count (defaults to 0 when null). The detail
 * page left-joins this against the respondent's visible question set.
 */
export async function getAnswersForResponse(
  supabase: SupabaseClient<Database>,
  responseId: string
): Promise<Map<string, AnswerDetail>> {
  const { data, error } = await supabase
    .from("answers")
    .select("question_id, answer_text, word_count")
    .eq("response_id", responseId);
  if (error) throw error;
  const map = new Map<string, AnswerDetail>();
  for (const row of data ?? []) {
    map.set(row.question_id, {
      questionId: row.question_id,
      answerText: row.answer_text ?? "",
      wordCount: row.word_count ?? 0,
    });
  }
  return map;
}
