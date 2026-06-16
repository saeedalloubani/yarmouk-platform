// lib/repos/questions.ts
//
// Public-flow read access to questionnaire questions. Per D48, the
// respondent flow uses the service-role admin client (no admin role
// in play) — these helpers take that client and never call
// getCurrentAdminRole. Questions are not PII.
//
// getVisibleQuestions applies the nationality filter ONCE (D32 /
// Edge 3): a question is visible when visible_nationalities IS NULL
// (everyone) or the respondent's nationality is in the array. The
// caller paginates the returned (filtered, ordered) list — it never
// re-filters per page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type Nationality = Database["public"]["Enums"]["nationality_type"];
type AnswerType = Database["public"]["Enums"]["answer_type"];

// D103 — one selectable option for a choice question. Carries BOTH labels
// (the wizard switches language live); `id` is what the answer references.
// option_code is server-side only (the save RPC keys on ids) — not surfaced.
export type VisibleOption = {
  id: string;
  labelEn: string;
  labelAr: string;
};

export type VisibleQuestion = {
  id: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  // D103 — answer type + per-question flags + (for choice types) the options.
  // free_text questions carry answerType 'free_text', no options — their
  // respondent path is unchanged.
  answerType: AnswerType;
  allowComment: boolean;
  allowSkip: boolean;
  options: VisibleOption[];
};

/** Active version's questions, filtered to this nationality, ordered.
 *  Choice questions get their options attached (batched, ordered). */
export async function getVisibleQuestions(
  admin: SupabaseClient<Database>,
  versionId: string,
  nationality: Nationality | null
): Promise<VisibleQuestion[]> {
  const { data, error } = await admin
    .from("questions")
    .select(
      "id, question_code, order_index, text_en, text_ar, is_feedback, is_required, visible_nationalities, answer_type, allow_comment, allow_skip"
    )
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });
  if (error) throw error;

  const visible = (data ?? []).filter(
    (q) =>
      q.visible_nationalities === null ||
      (nationality !== null && q.visible_nationalities.includes(nationality))
  );

  // Batch-load options for the choice questions among the visible set (one
  // query, ordered by order_index), keyed by question id.
  const choiceIds = visible
    .filter((q) => q.answer_type !== "free_text")
    .map((q) => q.id);
  const optionsByQuestion = new Map<string, VisibleOption[]>();
  if (choiceIds.length > 0) {
    const { data: optRows, error: optErr } = await admin
      .from("question_options")
      .select("question_id, id, label_en, label_ar, order_index")
      .in("question_id", choiceIds)
      .order("order_index", { ascending: true });
    if (optErr) throw optErr;
    for (const o of optRows ?? []) {
      const list = optionsByQuestion.get(o.question_id) ?? [];
      list.push({ id: o.id, labelEn: o.label_en, labelAr: o.label_ar });
      optionsByQuestion.set(o.question_id, list);
    }
  }

  return visible.map((q) => ({
    id: q.id,
    code: q.question_code,
    orderIndex: q.order_index,
    textEn: q.text_en,
    textAr: q.text_ar,
    isFeedback: q.is_feedback,
    isRequired: q.is_required,
    answerType: q.answer_type,
    allowComment: q.allow_comment,
    allowSkip: q.allow_skip,
    options: optionsByQuestion.get(q.id) ?? [],
  }));
}
