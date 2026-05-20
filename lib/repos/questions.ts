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

export type VisibleQuestion = {
  id: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
};

/** Active version's questions, filtered to this nationality, ordered. */
export async function getVisibleQuestions(
  admin: SupabaseClient<Database>,
  versionId: string,
  nationality: Nationality | null
): Promise<VisibleQuestion[]> {
  const { data, error } = await admin
    .from("questions")
    .select(
      "id, question_code, order_index, text_en, text_ar, is_feedback, is_required, visible_nationalities"
    )
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });
  if (error) throw error;

  return (data ?? [])
    .filter(
      (q) =>
        q.visible_nationalities === null ||
        (nationality !== null &&
          q.visible_nationalities.includes(nationality))
    )
    .map((q) => ({
      id: q.id,
      code: q.question_code,
      orderIndex: q.order_index,
      textEn: q.text_en,
      textAr: q.text_ar,
      isFeedback: q.is_feedback,
      isRequired: q.is_required,
    }));
}
