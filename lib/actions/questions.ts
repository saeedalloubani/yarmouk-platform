"use server";

// lib/actions/questions.ts
//
// Owner-only question-editor mutations (Session 3 — question editor).
// Every action: owner gate (+ forbidden warn-audit for an authenticated
// non-owner) → DRAFT gate (parent version must be 'draft', else 'frozen')
// → zod validate → mutate (lib/repos/questionnaires.ts) → log_audit (D54).
//
// Three enforcement layers for the D10 freeze: the editor page hides the UI
// for non-draft versions, the draft gate here refuses the mutation, and the
// questions_draft_only trigger (migration 017) is the DB backstop — no path
// can edit a non-draft version's questions.
//
// AUDIT METADATA stays lean and body-free: question TEXT is research-
// instrument content (not respondent PII), but the DB row is its source of
// truth — we log question_code + ids only, never the EN/AR bodies.

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin, type CurrentAdmin } from "@/lib/auth";
import {
  getVersion,
  getQuestion,
  getQuestionsForVersion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  setOrderIndices,
  type EditorQuestion,
  type EditorVersion,
} from "@/lib/repos/questionnaires";
import { logAudit } from "@/lib/audit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_MAX = 4000;

// visible_nationalities is NULL = everyone; an array narrows. The UI never
// sends an empty array, but we coalesce []→null defensively (an empty array
// would hide the question from EVERYONE — the renderer footgun).
const fieldsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Question code is required")
    .max(40, "Code too long")
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, dashes, underscores"),
  textEn: z.string().trim().min(1, "English text is required").max(TEXT_MAX),
  textAr: z.string().trim().min(1, "Arabic text is required").max(TEXT_MAX),
  isRequired: z.boolean(),
  isFeedback: z.boolean(),
  visibleNationalities: z
    .array(z.enum(["jordanian", "syrian"]))
    .nullable(),
});

type FieldsInput = z.infer<typeof fieldsSchema>;

export type QuestionActionError =
  | "forbidden"
  | "not_found"
  | "frozen"
  | "validation"
  | "code_taken"
  | "server";

export type CreateQuestionResult =
  | { ok: true; question: EditorQuestion }
  | { ok: false; error: QuestionActionError; issues?: string[] };

export type MutationResult =
  | { ok: true }
  | { ok: false; error: QuestionActionError; issues?: string[] };

// ---------------------------------------------------------------------------
// Shared gates
// ---------------------------------------------------------------------------

/** Owner gate; on an authenticated non-owner, warn-audit + return null. */
async function requireOwner(
  supabase: SupabaseClient<Database>,
  action: string,
  resource: string,
  meta: Record<string, unknown>
): Promise<CurrentAdmin | null> {
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action,
        resource,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role, ...meta },
      });
    }
    return null;
  }
  return admin;
}

/** Normalize visible_nationalities: empty array → null (the "all" footgun). */
function normVis(v: FieldsInput["visibleNationalities"]) {
  return v && v.length > 0 ? v : null;
}

/** is_feedback only allowed on versions whose includes_feedback_block is on. */
function feedbackAllowed(version: EditorVersion, isFeedback: boolean): boolean {
  return !isFeedback || version.includesFeedbackBlock;
}

// ---------------------------------------------------------------------------
// createQuestionAction
// ---------------------------------------------------------------------------

export type CreateQuestionInput = {
  versionId: string;
  code: string;
  textEn: string;
  textAr: string;
  isRequired: boolean;
  isFeedback: boolean;
  visibleNationalities: ("jordanian" | "syrian")[] | null;
};

export async function createQuestionAction(
  input: CreateQuestionInput
): Promise<CreateQuestionResult> {
  const supabase = await createSupabaseServerClient();
  const versionId =
    typeof input?.versionId === "string" ? input.versionId : "";

  const admin = await requireOwner(supabase, "question.create.forbidden", versionId, {});
  if (!admin) return { ok: false, error: "forbidden" };

  if (!UUID_RE.test(versionId)) return { ok: false, error: "not_found" };

  const version = await getVersion(supabase, versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "draft") return { ok: false, error: "frozen" };

  const parsed = fieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues.map((i) => i.message) };
  }
  const v = parsed.data;
  if (!feedbackAllowed(version, v.isFeedback)) {
    return { ok: false, error: "validation", issues: ["This version has no feedback block"] };
  }

  try {
    const existing = await getQuestionsForVersion(supabase, versionId);
    const nextOrder =
      existing.reduce((max, q) => Math.max(max, q.orderIndex), 0) + 1;

    const question = await createQuestion(supabase, {
      versionId,
      orderIndex: nextOrder,
      code: v.code,
      textEn: v.textEn,
      textAr: v.textAr,
      isRequired: v.isRequired,
      isFeedback: v.isFeedback,
      visibleNationalities: normVis(v.visibleNationalities),
    });

    await logAudit(supabase, {
      action: "question.create",
      resource: versionId,
      severity: "info",
      metadata: { questionId: question.id, code: question.code, isFeedback: question.isFeedback },
    });
    return { ok: true, question };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") return { ok: false, error: "code_taken" };
    console.error("[questions] create failed", err);
    return { ok: false, error: "server" };
  }
}

// ---------------------------------------------------------------------------
// updateQuestionAction
// ---------------------------------------------------------------------------

export type UpdateQuestionInput = {
  questionId: string;
  code: string;
  textEn: string;
  textAr: string;
  isRequired: boolean;
  isFeedback: boolean;
  visibleNationalities: ("jordanian" | "syrian")[] | null;
};

export async function updateQuestionAction(
  input: UpdateQuestionInput
): Promise<MutationResult> {
  const supabase = await createSupabaseServerClient();
  const questionId =
    typeof input?.questionId === "string" ? input.questionId : "";

  const admin = await requireOwner(supabase, "question.update.forbidden", "", { questionId });
  if (!admin) return { ok: false, error: "forbidden" };

  if (!UUID_RE.test(questionId)) return { ok: false, error: "not_found" };

  const question = await getQuestion(supabase, questionId);
  if (!question) return { ok: false, error: "not_found" };
  const version = await getVersion(supabase, question.versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "draft") return { ok: false, error: "frozen" };

  const parsed = fieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation", issues: parsed.error.issues.map((i) => i.message) };
  }
  const v = parsed.data;
  if (!feedbackAllowed(version, v.isFeedback)) {
    return { ok: false, error: "validation", issues: ["This version has no feedback block"] };
  }

  try {
    await updateQuestion(supabase, questionId, {
      code: v.code,
      textEn: v.textEn,
      textAr: v.textAr,
      isRequired: v.isRequired,
      isFeedback: v.isFeedback,
      visibleNationalities: normVis(v.visibleNationalities),
    });
    await logAudit(supabase, {
      action: "question.update",
      resource: question.versionId,
      severity: "info",
      metadata: { questionId, code: v.code },
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") return { ok: false, error: "code_taken" };
    console.error("[questions] update failed", err);
    return { ok: false, error: "server" };
  }
}

// ---------------------------------------------------------------------------
// deleteQuestionAction — delete + re-sequence to contiguous 1..N
// ---------------------------------------------------------------------------

export async function deleteQuestionAction(
  input: { questionId: string }
): Promise<MutationResult> {
  const supabase = await createSupabaseServerClient();
  const questionId =
    typeof input?.questionId === "string" ? input.questionId : "";

  const admin = await requireOwner(supabase, "question.delete.forbidden", "", { questionId });
  if (!admin) return { ok: false, error: "forbidden" };

  if (!UUID_RE.test(questionId)) return { ok: false, error: "not_found" };

  const question = await getQuestion(supabase, questionId);
  if (!question) return { ok: false, error: "not_found" };
  const version = await getVersion(supabase, question.versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "draft") return { ok: false, error: "frozen" };

  try {
    await deleteQuestion(supabase, questionId);

    // Re-sequence the remainder to contiguous 1..N (no gaps). Only write
    // rows whose order_index actually changed.
    const remaining = await getQuestionsForVersion(supabase, question.versionId);
    const resequenced = remaining
      .map((q, i) => ({ id: q.id, orderIndex: i + 1 }))
      .filter((r, i) => remaining[i].orderIndex !== r.orderIndex);
    if (resequenced.length > 0) await setOrderIndices(supabase, resequenced);

    await logAudit(supabase, {
      action: "question.delete",
      resource: question.versionId,
      severity: "info",
      metadata: { questionId, code: question.code },
    });
    return { ok: true };
  } catch (err) {
    console.error("[questions] delete failed", err);
    return { ok: false, error: "server" };
  }
}

// ---------------------------------------------------------------------------
// moveQuestionAction — up/down swap of order_index with the neighbor
// ---------------------------------------------------------------------------

export async function moveQuestionAction(
  input: { questionId: string; direction: "up" | "down" }
): Promise<MutationResult> {
  const supabase = await createSupabaseServerClient();
  const questionId =
    typeof input?.questionId === "string" ? input.questionId : "";
  const direction = input?.direction;

  const admin = await requireOwner(supabase, "question.reorder.forbidden", "", { questionId });
  if (!admin) return { ok: false, error: "forbidden" };

  if (!UUID_RE.test(questionId) || (direction !== "up" && direction !== "down")) {
    return { ok: false, error: "validation" };
  }

  const question = await getQuestion(supabase, questionId);
  if (!question) return { ok: false, error: "not_found" };
  const version = await getVersion(supabase, question.versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "draft") return { ok: false, error: "frozen" };

  try {
    const ordered = await getQuestionsForVersion(supabase, question.versionId);
    const idx = ordered.findIndex((q) => q.id === questionId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) {
      return { ok: true }; // at a boundary — no-op
    }
    const a = ordered[idx];
    const b = ordered[swapIdx];
    await setOrderIndices(supabase, [
      { id: a.id, orderIndex: b.orderIndex },
      { id: b.id, orderIndex: a.orderIndex },
    ]);
    await logAudit(supabase, {
      action: "question.reorder",
      resource: question.versionId,
      severity: "info",
      metadata: { questionId, code: question.code, direction },
    });
    return { ok: true };
  } catch (err) {
    console.error("[questions] reorder failed", err);
    return { ok: false, error: "server" };
  }
}
