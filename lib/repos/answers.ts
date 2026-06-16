// lib/repos/answers.ts
//
// Public-flow read/write access to the answers table. Per D48 the
// respondent flow uses the service-role admin client; these helpers
// take it and never role-branch. answers is NOT PII (no redacted
// view) — direct base-table access (CONVENTIONS non-PII allow-list).
//
// word_count is a GENERATED STORED column — never written here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/** All answers for a response, as a { questionId: text } map. */
export async function getAnswersMap(
  admin: SupabaseClient<Database>,
  responseId: string
): Promise<Record<string, string>> {
  const { data, error } = await admin
    .from("answers")
    .select("question_id, answer_text")
    .eq("response_id", responseId);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.question_id] = row.answer_text ?? "";
  return map;
}

// D103 — a returning respondent's prior choice answers, for resume-rehydrate
// (the wizard re-checks the right radios/boxes and refills the comment box).
export type ChoiceAnswer = { optionIds: string[]; comment: string | null };

/** Choice selections + comment for a response, keyed by question id. Only
 *  questions that actually have a selection or a comment appear (free_text
 *  answers, which never write either, are absent). */
export async function getChoiceAnswers(
  admin: SupabaseClient<Database>,
  responseId: string
): Promise<Record<string, ChoiceAnswer>> {
  const { data: aRows, error: aErr } = await admin
    .from("answers")
    .select("id, question_id, answer_comment")
    .eq("response_id", responseId);
  if (aErr) throw aErr;
  const rows = aRows ?? [];
  if (rows.length === 0) return {};

  const questionByAnswerId = new Map<string, string>();
  for (const r of rows) questionByAnswerId.set(r.id, r.question_id);

  const { data: selRows, error: sErr } = await admin
    .from("answer_options")
    .select("answer_id, option_id")
    .in(
      "answer_id",
      rows.map((r) => r.id)
    );
  if (sErr) throw sErr;

  const optionIdsByQuestion: Record<string, string[]> = {};
  for (const s of selRows ?? []) {
    const qid = questionByAnswerId.get(s.answer_id);
    if (!qid) continue;
    (optionIdsByQuestion[qid] ??= []).push(s.option_id);
  }

  const out: Record<string, ChoiceAnswer> = {};
  for (const r of rows) {
    const optionIds = optionIdsByQuestion[r.question_id] ?? [];
    const comment = r.answer_comment ?? null;
    if (optionIds.length > 0 || comment !== null) {
      out[r.question_id] = { optionIds, comment };
    }
  }
  return out;
}

/** Question_ids SATISFIED for the submit gate — TYPE-AWARE (D103):
 *    free_text → answer_text non-empty (unchanged from the pre-D103 rule);
 *    single/multi_choice → at least one selected option (answer_options row);
 *    allow_skip → always satisfied (a no-answer is permitted even when
 *                 is_required), so a skippable question never blocks submit.
 *  Takes the question metadata (the caller already has the visible set) so the
 *  rule can branch per type. For a free_text-only questionnaire this reduces
 *  to exactly the old "answer_text non-empty" behavior. */
export async function getAnsweredQuestionIds(
  admin: SupabaseClient<Database>,
  responseId: string,
  questions: { id: string; answerType: Database["public"]["Enums"]["answer_type"]; allowSkip: boolean }[]
): Promise<Set<string>> {
  // 1. free_text answeredness: answer_text non-empty, keyed by question id.
  const { data: aRows, error: aErr } = await admin
    .from("answers")
    .select("id, question_id, answer_text")
    .eq("response_id", responseId);
  if (aErr) throw aErr;
  const rows = aRows ?? [];

  const textNonEmpty = new Set<string>();
  const answerIds: string[] = [];
  const questionByAnswerId = new Map<string, string>();
  for (const r of rows) {
    answerIds.push(r.id);
    questionByAnswerId.set(r.id, r.question_id);
    if ((r.answer_text ?? "").trim().length > 0) textNonEmpty.add(r.question_id);
  }

  // 2. choice answeredness: question ids with >=1 selected option.
  const hasSelection = new Set<string>();
  if (answerIds.length > 0) {
    const { data: selRows, error: sErr } = await admin
      .from("answer_options")
      .select("answer_id")
      .in("answer_id", answerIds);
    if (sErr) throw sErr;
    for (const s of selRows ?? []) {
      const qid = questionByAnswerId.get(s.answer_id);
      if (qid) hasSelection.add(qid);
    }
  }

  // 3. Apply the per-type satisfaction rule.
  const set = new Set<string>();
  for (const q of questions) {
    const satisfied = q.allowSkip
      ? true
      : q.answerType === "free_text"
      ? textNonEmpty.has(q.id)
      : hasSelection.has(q.id);
    if (satisfied) set.add(q.id);
  }
  return set;
}

/** Upsert one answer. word_count is generated; updated_at refreshed
 *  explicitly (DEFAULT NOW() does not re-fire on UPDATE). Returns the
 *  error (if any) rather than throwing, so the caller can degrade
 *  gracefully (answer-save is the more valuable write). */
export async function upsertAnswer(
  admin: SupabaseClient<Database>,
  responseId: string,
  questionId: string,
  text: string
): Promise<{ error: unknown }> {
  const { error } = await admin.from("answers").upsert(
    {
      response_id: responseId,
      question_id: questionId,
      answer_text: text,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "response_id,question_id" }
  );
  return { error };
}
