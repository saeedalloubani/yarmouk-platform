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

/** Question_ids with a non-empty answer for a response (submit gate). */
export async function getAnsweredQuestionIds(
  admin: SupabaseClient<Database>,
  responseId: string
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("answers")
    .select("question_id, answer_text")
    .eq("response_id", responseId);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    if ((row.answer_text ?? "").trim().length > 0) set.add(row.question_id);
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
