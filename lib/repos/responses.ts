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

export type ResponseRow = {
  id: string;
  invitationId: string;
  language: "en" | "ar";
  startedAt: string;
  submittedAt: string | null;
  durationMinutes: number | null;
  isLocked: boolean;
};

export type AnswerDetail = {
  questionId: string;
  answerText: string;
  wordCount: number;
};

function rowToResponse(r: DbRow): ResponseRow {
  // language is narrowed via `as 'en' | 'ar'` because the DB CHECK enforces
  // this but Supabase gen types widen it to string.
  return {
    id: r.id,
    invitationId: r.invitation_id,
    language: r.language as "en" | "ar",
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    durationMinutes: r.duration_minutes,
    isLocked: r.is_locked,
  };
}

/** All responses (unordered here — callers sort). Non-PII; both roles. */
export async function listResponses(
  supabase: SupabaseClient<Database>
): Promise<ResponseRow[]> {
  const { data, error } = await supabase
    .from("responses")
    .select("id, invitation_id, language, started_at, submitted_at, duration_minutes, is_locked")
    .order("started_at", { ascending: false });
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
    .select("id, invitation_id, language, started_at, submitted_at, duration_minutes, is_locked")
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
