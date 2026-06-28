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

// D106 — the choice-aware admin READ keystone. ONE loader that returns every
// answer in full: the free_text body, the choice selections WITH their option
// labels/codes, and the comment. Admin surfaces read through this instead of
// re-implementing the answers→answer_options→question_options join per surface
// (the pre-D106 readers selected answer_text only, so a choice answer — whose
// answer_text is '' — rendered blank). Generalizes getChoiceAnswers (which
// serves the respondent resume path) for admin reads across one OR many
// responses. Pure read; no writes. D107 (exports) reads through it too.
export type SelectedOption = {
  id: string;
  labelEn: string;
  labelAr: string;
  optionCode: string;
};

export type RichAnswer = {
  // answer_type lives on the QUESTION (answers carries no type column), so the
  // loader sources it from questions. Defaults to free_text defensively.
  answerType: Database["public"]["Enums"]["answer_type"];
  text: string; // answer_text — the free_text body; '' for a choice answer
  selectedOptions: SelectedOption[]; // ordered by option order_index; [] for free_text
  comment: string | null; // answer_comment — present for choice w/ allow_comment
  wordCount: number; // GENERATED column; 0 for a choice answer (no prose)
};

/** Full answers for one or many responses, keyed response_id → question_id →
 *  RichAnswer. Four batched SELECTs: answers, questions (for answer_type),
 *  answer_options (selections), question_options (labels/codes). */
export async function getRichAnswers(
  admin: SupabaseClient<Database>,
  responseIds: string[]
): Promise<Map<string, Map<string, RichAnswer>>> {
  const out = new Map<string, Map<string, RichAnswer>>();
  if (responseIds.length === 0) return out;

  // 1. answer rows for the response set.
  const { data: aRows, error: aErr } = await admin
    .from("answers")
    .select("id, response_id, question_id, answer_text, answer_comment, word_count")
    .in("response_id", responseIds);
  if (aErr) throw aErr;
  const rows = aRows ?? [];
  if (rows.length === 0) return out;

  // 2. answer_type per question — answers has no type column; it lives on the
  //    question. One batched lookup over the distinct question ids.
  const questionIds = Array.from(new Set(rows.map((r) => r.question_id)));
  const { data: qRows, error: qErr } = await admin
    .from("questions")
    .select("id, answer_type")
    .in("id", questionIds);
  if (qErr) throw qErr;
  const answerTypeByQuestion = new Map(
    (qRows ?? []).map((q) => [q.id, q.answer_type] as const)
  );

  // 3. selected option ids per answer.
  const answerIds = rows.map((r) => r.id);
  const { data: selRows, error: sErr } = await admin
    .from("answer_options")
    .select("answer_id, option_id")
    .in("answer_id", answerIds);
  if (sErr) throw sErr;
  const optionIdsByAnswer = new Map<string, string[]>();
  for (const s of selRows ?? []) {
    const list = optionIdsByAnswer.get(s.answer_id) ?? [];
    list.push(s.option_id);
    optionIdsByAnswer.set(s.answer_id, list);
  }

  // 4. labels/codes/order for every selected option.
  const optionIds = Array.from(new Set((selRows ?? []).map((s) => s.option_id)));
  const optionById = new Map<
    string,
    { id: string; labelEn: string; labelAr: string; optionCode: string; orderIndex: number }
  >();
  if (optionIds.length > 0) {
    const { data: optRows, error: oErr } = await admin
      .from("question_options")
      .select("id, label_en, label_ar, option_code, order_index")
      .in("id", optionIds);
    if (oErr) throw oErr;
    for (const o of optRows ?? []) {
      optionById.set(o.id, {
        id: o.id,
        labelEn: o.label_en,
        labelAr: o.label_ar,
        optionCode: o.option_code,
        orderIndex: o.order_index,
      });
    }
  }

  // 5. assemble — selections sorted by option order_index for stable display.
  for (const r of rows) {
    const selectedOptions: SelectedOption[] = (optionIdsByAnswer.get(r.id) ?? [])
      .map((oid) => optionById.get(oid))
      .filter((o): o is NonNullable<typeof o> => o != null)
      .sort((x, y) => x.orderIndex - y.orderIndex)
      .map((o) => ({
        id: o.id,
        labelEn: o.labelEn,
        labelAr: o.labelAr,
        optionCode: o.optionCode,
      }));
    const rich: RichAnswer = {
      answerType: answerTypeByQuestion.get(r.question_id) ?? "free_text",
      text: r.answer_text ?? "",
      selectedOptions,
      comment: r.answer_comment ?? null,
      wordCount: r.word_count ?? 0,
    };
    let bucket = out.get(r.response_id);
    if (!bucket) {
      bucket = new Map<string, RichAnswer>();
      out.set(r.response_id, bucket);
    }
    bucket.set(r.question_id, rich);
  }
  return out;
}

/** Shared "is this answer answered?" predicate for admin COUNT surfaces (the
 *  detail "Answered X/N" and the responses-list answered tally). CONTENT-based,
 *  matching the submit gate's per-type rule MINUS allow_skip: free_text →
 *  non-empty text; choice → at least one selected option. A skippable question
 *  left empty has no content, so it counts as NOT answered — honest for a
 *  display tally. A comment alone never counts (mirrors the gate: a choice
 *  question needs a selection, not just a comment). */
export function richAnswerIsAnswered(r: RichAnswer): boolean {
  return r.answerType === "free_text"
    ? r.text.trim().length > 0
    : r.selectedOptions.length > 0;
}

/** D107 — ENGLISH-CANONICAL flat rendering of an answer's VALUE for the
 *  export surfaces (ATLAS wide + long-format). Language-INDEPENDENT by lock:
 *  always the English label, never the respondent's — canonical for ATLAS
 *  coding so the same answer codes identically regardless of which language
 *  the respondent used.
 *    free_text  → the body verbatim (so the free_text/pilot export path is
 *                 BYTE-IDENTICAL — this returns exactly the old answer_text).
 *    single/multi_choice → "optionCode: labelEn" per selection, joined by
 *                 " | " (space-pipe-space; comma-free so labels containing
 *                 commas stay parseable). Empty selection → "" (blank cell,
 *                 which ATLAS reads as no-answer — same as before).
 *  The COMMENT is NOT included here — exports carry it in its own column. */
export function renderAnswerValue(r: RichAnswer): string {
  if (r.answerType === "free_text") return r.text;
  return r.selectedOptions
    .map((o) => `${o.optionCode}: ${o.labelEn}`)
    .join(" | ");
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
