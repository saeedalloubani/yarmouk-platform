// lib/repos/feedback.ts
//
// Read-aggregation for the Pilot-Feedback Hub (/admin/analytics/feedback).
// The pilot questionnaire carries a built-in F1–F4 feedback block (D9);
// feedback answers are ordinary `answers` rows whose question has
// is_feedback = true. This groups them by feedback question for the hub.
//
// Conventions mirror lib/repos/dashboard.ts:
//   - AUTHENTICATED server client (RLS applies); answers/questions/responses
//     are on the non-PII allow-list (both roles SELECT).
//   - Demographics (ref_code / category / nationality) come from
//     `invitations_redacted` — the VIEW, never the invitations base table —
//     and we select ONLY those three non-PII columns (the view also lists the
//     encrypted name/email columns; we never touch them).
//   - Joins done IN MEMORY by Map, not PostgREST embeds onto a PII base table.
//   - snake→camel by hand; null-safe at 0 rows by construction.
//
// SUBMITTED-ONLY: only answers from a submitted response count — draft /
// in-progress feedback isn't final. Enforced by reading only submitted
// responses (submitted_at IS NOT NULL) and skipping any answer whose response
// isn't in that set.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type FeedbackAnswer = {
  refCode: string;
  category: string;
  nationality: string | null;
  language: string;
  answerText: string;
  submittedAt: string; // ISO timestamp of the response submission
};

export type FeedbackQuestion = {
  questionCode: string; // F1..F4
  orderIndex: number;
  textEn: string;
  textAr: string;
  answers: FeedbackAnswer[]; // newest submission first; [] when none yet
};

/**
 * F1–F4 feedback questions, each with its submitted-response answers.
 * Always returns every feedback question (even with zero answers) so the hub
 * can render all sections; the page shows a global empty state when the total
 * across all questions is zero. Null-safe: a fresh DB returns the 4 seeded
 * questions each with an empty answers array.
 */
export async function getPilotFeedback(
  supabase: SupabaseClient<Database>
): Promise<FeedbackQuestion[]> {
  // 1. The feedback questions (F1–F4), in display order.
  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select("id, question_code, order_index, text_en, text_ar")
    .eq("is_feedback", true)
    .order("order_index", { ascending: true });
  if (qErr) throw qErr;
  const questions = qRows ?? [];
  if (questions.length === 0) return [];

  const questionIds = questions.map((q) => q.id);

  // 2. Answers to those questions (across all responses; filtered to submitted
  //    below via the in-memory join).
  const { data: aRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, question_id, answer_text")
    .in("question_id", questionIds);
  if (aErr) throw aErr;
  const answers = aRows ?? [];

  // 3. SUBMITTED + ACTIVE responses only — draft/in-progress feedback
  //    isn't final (D9), and withdrawn responses are excluded from
  //    pilot-feedback aggregation (D63). The in-memory orphan-drop at
  //    step 5's grouping loop cascades the filter to the answers fetched
  //    in step 2 (any answer whose response isn't in respById is
  //    skipped), so no extra answers-query change is needed.
  const { data: rRows, error: rErr } = await supabase
    .from("responses")
    .select("id, invitation_id, language, submitted_at")
    .not("submitted_at", "is", null)
    .eq("status", "active");
  if (rErr) throw rErr;
  const respById = new Map((rRows ?? []).map((r) => [r.id, r] as const));

  // 4. Demographics from the REDACTED view — only the 3 non-PII columns.
  const { data: iRows, error: iErr } = await supabase
    .from("invitations_redacted")
    .select("id, ref_code, category, nationality");
  if (iErr) throw iErr;
  const invById = new Map((iRows ?? []).map((i) => [i.id, i] as const));

  // Group answers under their question, joining response + invitation in
  // memory. An answer whose response isn't in respById is skipped — that IS
  // the submitted-only filter (step 3 fetched submitted responses only).
  const byQuestion = new Map<string, FeedbackAnswer[]>();
  for (const a of answers) {
    const resp = respById.get(a.response_id);
    if (!resp || !resp.submitted_at) continue; // submitted-only
    const inv = invById.get(resp.invitation_id);
    const entry: FeedbackAnswer = {
      refCode: inv?.ref_code ?? "—",
      category: inv?.category ?? "—",
      nationality: inv?.nationality ?? null,
      language: resp.language,
      answerText: a.answer_text,
      submittedAt: resp.submitted_at,
    };
    const list = byQuestion.get(a.question_id);
    if (list) list.push(entry);
    else byQuestion.set(a.question_id, [entry]);
  }

  return questions.map((q) => {
    const list = byQuestion.get(q.id) ?? [];
    list.sort((x, y) => y.submittedAt.localeCompare(x.submittedAt)); // newest first
    return {
      questionCode: q.question_code,
      orderIndex: q.order_index,
      textEn: q.text_en,
      textAr: q.text_ar,
      answers: list,
    };
  });
}
