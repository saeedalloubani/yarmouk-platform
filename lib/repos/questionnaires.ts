// lib/repos/questionnaires.ts
//
// Admin-side reads + write helpers for the question EDITOR (Session 3 —
// question editor). Distinct from lib/repos/questions.ts, which is the
// PUBLIC-flow read path (service-role client, nationality-filtered,
// renderer-shaped). This module is for the owner editing instrument
// content: it takes the AUTHENTICATED server client so RLS applies, and
// returns the UNFILTERED question set with every editable column.
//
// NON-PII (questions / questionnaire_versions are on the allow-list). No
// role branch here — RLS gates it (q_owner_* writes; q_admins_select reads).
// The DB also enforces D10 structurally: the questions_draft_only trigger
// (migration 017) rejects any mutation whose parent version isn't 'draft'.
// The calling actions draft-gate first; this trigger is the backstop.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type Nationality = Database["public"]["Enums"]["nationality_type"];
type VersionStatus = Database["public"]["Enums"]["version_status"];

export type EditorVersion = {
  id: string;
  variant: string;
  type: string;
  versionNumber: number;
  status: VersionStatus;
  includesFeedbackBlock: boolean;
};

export type EditorQuestion = {
  id: string;
  versionId: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  visibleNationalities: Nationality[] | null;
};

export type QuestionFields = {
  code: string;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  visibleNationalities: Nationality[] | null;
};

function rowToVersion(r: {
  id: string;
  variant: string;
  type: string;
  version_number: number;
  status: string;
  includes_feedback_block: boolean;
}): EditorVersion {
  return {
    id: r.id,
    variant: r.variant,
    type: r.type,
    versionNumber: r.version_number,
    status: r.status as VersionStatus,
    includesFeedbackBlock: r.includes_feedback_block,
  };
}

function rowToQuestion(r: {
  id: string;
  version_id: string;
  question_code: string;
  order_index: number;
  text_en: string;
  text_ar: string;
  is_feedback: boolean;
  is_required: boolean;
  visible_nationalities: string[] | null;
}): EditorQuestion {
  return {
    id: r.id,
    versionId: r.version_id,
    code: r.question_code,
    orderIndex: r.order_index,
    textEn: r.text_en,
    textAr: r.text_ar,
    isFeedback: r.is_feedback,
    isRequired: r.is_required,
    visibleNationalities: (r.visible_nationalities as Nationality[] | null) ?? null,
  };
}

const VERSION_COLS =
  "id, variant, type, version_number, status, includes_feedback_block";
const QUESTION_COLS =
  "id, version_id, question_code, order_index, text_en, text_ar, is_feedback, is_required, visible_nationalities";

/** All versions (drafts + active + closed), ordered for the editor list. */
export async function listVersionsForEditor(
  supabase: SupabaseClient<Database>
): Promise<EditorVersion[]> {
  const { data, error } = await supabase
    .from("questionnaire_versions")
    .select(VERSION_COLS)
    .order("variant", { ascending: true })
    .order("version_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToVersion);
}

/** Single version by id, or null. */
export async function getVersion(
  supabase: SupabaseClient<Database>,
  versionId: string
): Promise<EditorVersion | null> {
  const { data, error } = await supabase
    .from("questionnaire_versions")
    .select(VERSION_COLS)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToVersion(data) : null;
}

/** All questions for a version, ordered by order_index (UNFILTERED). */
export async function getQuestionsForVersion(
  supabase: SupabaseClient<Database>,
  versionId: string
): Promise<EditorQuestion[]> {
  const { data, error } = await supabase
    .from("questions")
    .select(QUESTION_COLS)
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToQuestion);
}

/** Single question by id, or null. */
export async function getQuestion(
  supabase: SupabaseClient<Database>,
  questionId: string
): Promise<EditorQuestion | null> {
  const { data, error } = await supabase
    .from("questions")
    .select(QUESTION_COLS)
    .eq("id", questionId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToQuestion(data) : null;
}

/** Per-version question counts (for the drafts list). Map keyed by version id. */
export async function getQuestionCounts(
  supabase: SupabaseClient<Database>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabase.from("questions").select("version_id");
  if (error) throw error;
  for (const row of data ?? []) {
    counts.set(row.version_id, (counts.get(row.version_id) ?? 0) + 1);
  }
  return counts;
}

/** Insert a question. Caller assigns code + order_index. Returns the row. */
export async function createQuestion(
  supabase: SupabaseClient<Database>,
  input: QuestionFields & { versionId: string; orderIndex: number }
): Promise<EditorQuestion> {
  const { data, error } = await supabase
    .from("questions")
    .insert({
      version_id: input.versionId,
      question_code: input.code,
      order_index: input.orderIndex,
      text_en: input.textEn,
      text_ar: input.textAr,
      is_feedback: input.isFeedback,
      is_required: input.isRequired,
      visible_nationalities: input.visibleNationalities,
    })
    .select(QUESTION_COLS)
    .single();
  if (error) throw error;
  return rowToQuestion(data);
}

/** Update a question's editable fields. */
export async function updateQuestion(
  supabase: SupabaseClient<Database>,
  questionId: string,
  fields: QuestionFields
): Promise<void> {
  const { error } = await supabase
    .from("questions")
    .update({
      question_code: fields.code,
      text_en: fields.textEn,
      text_ar: fields.textAr,
      is_feedback: fields.isFeedback,
      is_required: fields.isRequired,
      visible_nationalities: fields.visibleNationalities,
    })
    .eq("id", questionId);
  if (error) throw error;
}

/** Delete a question. */
export async function deleteQuestion(
  supabase: SupabaseClient<Database>,
  questionId: string
): Promise<void> {
  const { error } = await supabase.from("questions").delete().eq("id", questionId);
  if (error) throw error;
}

/**
 * Apply a batch of (id → order_index) updates. order_index has no unique
 * constraint, so swaps/renumbers need no temp value. Used by delete
 * re-sequencing and up/down moves.
 */
export async function setOrderIndices(
  supabase: SupabaseClient<Database>,
  items: { id: string; orderIndex: number }[]
): Promise<void> {
  for (const it of items) {
    const { error } = await supabase
      .from("questions")
      .update({ order_index: it.orderIndex })
      .eq("id", it.id);
    if (error) throw error;
  }
}
