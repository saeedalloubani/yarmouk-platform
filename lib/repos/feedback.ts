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
//
// D73 — CROSS-VARIANT POOLING: each of the 4 active pilot variants
// (officials/researchers/donors/ngos) has its own F1–F4 rows in `questions`
// with distinct UUIDs but byte-identical text (verified in seed migration
// 20260524150001 — "shared core … md5-verified"). Before D73 this repo
// pulled all 16 feedback rows and rendered 16 sections (4 per code, only 1
// populated per code); OFF-JOR-02's first real submission surfaced the
// bug. We now collapse to ONE F1/F2/F3/F4 section by deduping the questions
// list by `question_code` and re-keying the in-memory answers join from
// question_id to question_code, so answers from any variant pool into the
// canonical section. F1–F4 are about questionnaire UX (clarity, length,
// missing topics, completion time) — pooling across variants is the
// correct unit. Per-variant breakdown would be a follow-on analytics
// feature, not a regression of this fix.

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
  // 1. The feedback questions — across ALL pilot variants. Each active
  //    variant (officials/researchers/donors/ngos) has its own F1–F4
  //    rows (UNIQUE (version_id, question_code), so a code appears once
  //    per variant — 16 rows total at present). We order by order_index
  //    ASC so the dedupe loop below picks the lowest-order_index row as
  //    the stable representative for each code.
  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select("id, question_code, order_index, text_en, text_ar")
    .eq("is_feedback", true)
    .order("order_index", { ascending: true });
  if (qErr) throw qErr;
  const allFeedbackRows = qRows ?? [];
  if (allFeedbackRows.length === 0) return [];

  // D73 — id → code lookup across ALL variant rows. Built BEFORE the
  // dedupe below because step 5's answers-join needs every variant UUID
  // to collapse `answers.question_id` (one of N variant UUIDs for the
  // same code) into the canonical code bucket.
  const idToCode = new Map<string, string>();
  for (const q of allFeedbackRows) idToCode.set(q.id, q.question_code);

  // D73 — Dedupe to one question per question_code. Text is byte-
  // identical across variants (seed 20260524150001 audit:
  // "md5-verified"), so any variant's row is a valid representative;
  // walking the already-ASC-ordered list and keeping first-seen yields
  // the lowest-order_index representative as a side effect. Result: 4
  // questions (F1, F2, F3, F4) instead of 16. The render layer
  // (feedback/page.tsx) keys by `q.questionCode` and now gets unique
  // React keys — the latent dup-key dev warning is resolved as a bonus.
  const questions: typeof allFeedbackRows = [];
  const seenCodes = new Set<string>();
  for (const q of allFeedbackRows) {
    if (seenCodes.has(q.question_code)) continue;
    seenCodes.add(q.question_code);
    questions.push(q);
  }

  // `questionIds` carries ALL variant UUIDs so any variant's F1/F2/F3/F4
  // answer is fetched in step 2 below — the cross-variant pool happens
  // in step 5's grouping loop via idToCode.
  const questionIds = allFeedbackRows.map((q) => q.id);

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

  // 5. Group answers under their CANONICAL question_code (D73). Each
  //    answer's question_id maps via idToCode to its code, and answers
  //    from all variants bucket together. An answer whose response
  //    isn't in respById is skipped — that IS the submitted-only filter
  //    (step 3 fetched submitted responses only). A code-less answer
  //    (defensive: question_id no longer in idToCode because the row
  //    was later un-flagged as feedback) is silently skipped.
  const byQuestionCode = new Map<string, FeedbackAnswer[]>();
  for (const a of answers) {
    const resp = respById.get(a.response_id);
    if (!resp || !resp.submitted_at) continue; // submitted-only
    const code = idToCode.get(a.question_id);
    if (!code) continue; // defensive: not a feedback question anymore
    const inv = invById.get(resp.invitation_id);
    const entry: FeedbackAnswer = {
      refCode: inv?.ref_code ?? "—",
      category: inv?.category ?? "—",
      nationality: inv?.nationality ?? null,
      language: resp.language,
      answerText: a.answer_text,
      submittedAt: resp.submitted_at,
    };
    const list = byQuestionCode.get(code);
    if (list) list.push(entry);
    else byQuestionCode.set(code, [entry]);
  }

  return questions.map((q) => {
    const list = byQuestionCode.get(q.question_code) ?? [];
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
