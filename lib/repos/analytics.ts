// lib/repos/analytics.ts
//
// D87 — Read-aggregation for the per-question pivot view
// (/admin/analytics/questions). Sister to lib/repos/feedback.ts: same
// aggregate pattern (in-memory join, invitations_redacted demographics,
// submitted+active filter), but for the FULL question set of a single
// (variant, version) — not just the F1–F4 feedback block.
//
// ─── CORRECTNESS LOCK (D87 grouping key) ─────────────────────────────
//
// Grouping is BY questions.id (UUID), NEVER by question_code alone.
// Each questionnaire_versions row owns its own `questions` rows
// (UNIQUE (version_id, question_code) per migration
// 20260519170002_tables.sql), and answers.question_id FKs to that exact
// row. So an answer always resolves to the version-specific wording the
// respondent saw. Two distinct merge traps that the UUID-keyed grouping
// guards against:
//   (a) WITHIN-VARIANT trap — same code, different wording across the
//       4 pilot variants. Per seed 20260524150001:
//         "core (Q1-Q4, catch-all, F1-F4) is byte-identical across
//          variants (md5-verified)"
//       which implicitly confirms Q5-Q11 DIFFER per variant (e.g.
//       officials Q10 is Syria-only "new phase of development";
//       researchers Q10 is "change of government dynamics"). Naively
//       grouping by code across variants would collapse them.
//   (b) ACROSS-VERSION trap — when main-study versions ship, the same
//       code may carry different wording across pilot V1 and main V1.
//       Same fix applies.
//
// D87 SCOPE LOCK: single (variant, version) only. NO cross-variant
// pooling, NO cross-version pooling. Pooling — if ever justified — is a
// later D-number with byte-equality verification, kept out of D87 per
// brief.
//
// ─── PII / ROLE DISCIPLINE ───────────────────────────────────────────
//
// Same shape as lib/repos/feedback.ts:
//   - AUTHENTICATED server client (RLS applies); questions / answers /
//     responses / questionnaire_versions are non-PII allow-list (both
//     roles SELECT).
//   - Demographics come from invitations_redacted — the VIEW, never
//     the base table — and we select ONLY ref_code / category /
//     nationality (the view also lists the encrypted name/email
//     columns; we never touch them).
//   - No PostgREST embeds onto the invitations base table. Joins done
//     in memory by Map.
//   - snake→camel by hand; null-safe at 0 rows by construction.
//   - SUBMITTED-ONLY + ACTIVE-ONLY responses (matches feedback.ts and
//     D63 cross-cutting filter).
//
// BOTH ROLES: this is non-PII research data (ref_code is the public
// handle), same access model as /admin/analytics/feedback.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type Nationality = Database["public"]["Enums"]["nationality_type"];
type VersionStatus = Database["public"]["Enums"]["version_status"];

export type AnalyticsVariantVersion = {
  versionId: string;
  variant: string;
  type: string;
  versionNumber: number;
  status: VersionStatus;
  publishedAt: string | null;
  closedAt: string | null;
  /** Count of submitted + active responses bound to this version via
   *  invitations.questionnaire_version_id. Used to decorate selector
   *  options ("N submissions") and to drive the "default to most-
   *  recently-active" pick. */
  submittedCount: number;
};

export type PivotQuestion = {
  questionId: string;
  questionCode: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  visibleNationalities: Nationality[] | null;
};

export type PivotAnswer = {
  responseId: string;
  refCode: string;
  category: string;
  nationality: Nationality | null;
  language: "en" | "ar";
  answerText: string;
  submittedAt: string; // ISO timestamp
};

export type PivotData = {
  version: AnalyticsVariantVersion;
  questions: PivotQuestion[];
  /** Map keyed by questionId. Pre-sorted newest-submitted first.
   *  questionIds with zero submitted+active answers are PRESENT in
   *  the map with an empty array (so the UI can render "no responses
   *  yet" per-question without lookup misses). */
  answersByQuestionId: Map<string, PivotAnswer[]>;
};

// ─── version listing for the selector ────────────────────────────────

/**
 * All questionnaire versions, decorated with submitted+active response
 * counts. Ordered for the selector: variants in canonical display order
 * (officials → researchers → donors → ngos for pilots, then mains),
 * version_number ASC within a variant. The "first" entry by this order
 * is the default-pick anchor when the variant has no active version
 * (see pickDefaultVersionId below).
 *
 * Non-PII: the view + count are derived without touching invitations
 * base table or any encrypted column.
 */
export async function listAnalyticsVersions(
  supabase: SupabaseClient<Database>
): Promise<AnalyticsVariantVersion[]> {
  // 1. All versions — id + display metadata.
  const { data: vRows, error: vErr } = await supabase
    .from("questionnaire_versions")
    .select(
      "id, variant, type, version_number, status, published_at, closed_at"
    );
  if (vErr) throw vErr;
  const versions = vRows ?? [];
  if (versions.length === 0) return [];

  // 2. Submitted + active responses → invitation_id → questionnaire_version_id.
  //    Two reads (responses, then invitations_redacted) because joining
  //    via PostgREST embed would route through the invitations base
  //    table. In-memory join is the established pattern (feedback.ts,
  //    dashboard.ts).
  const { data: rRows, error: rErr } = await supabase
    .from("responses")
    .select("invitation_id, submitted_at")
    .eq("status", "active")
    .not("submitted_at", "is", null);
  if (rErr) throw rErr;
  const respInvitationIds = (rRows ?? []).map((r) => r.invitation_id);

  // Map invitation_id → version_id for the responses we care about.
  // The redacted VIEW types its columns as `string | null` (PostgREST
  // generated types treat all view columns as nullable even when the
  // underlying base column is NOT NULL). The base
  // `invitations.id` and `invitations.questionnaire_version_id` are
  // both NOT NULL — we narrow defensively here so the Map keys/values
  // are well-typed.
  const invToVersion = new Map<string, string>();
  if (respInvitationIds.length > 0) {
    const { data: iRows, error: iErr } = await supabase
      .from("invitations_redacted")
      .select("id, questionnaire_version_id")
      .in("id", respInvitationIds);
    if (iErr) throw iErr;
    for (const i of iRows ?? []) {
      if (i.id && i.questionnaire_version_id) {
        invToVersion.set(i.id, i.questionnaire_version_id);
      }
    }
  }

  // Tally submitted-count per version_id.
  const submittedByVersion = new Map<string, number>();
  for (const r of rRows ?? []) {
    const versionId = invToVersion.get(r.invitation_id);
    if (!versionId) continue;
    submittedByVersion.set(versionId, (submittedByVersion.get(versionId) ?? 0) + 1);
  }

  // 3. Map + sort.
  const decorated: AnalyticsVariantVersion[] = versions.map((v) => ({
    versionId: v.id,
    variant: v.variant,
    type: v.type,
    versionNumber: v.version_number,
    status: v.status as VersionStatus,
    publishedAt: v.published_at,
    closedAt: v.closed_at,
    submittedCount: submittedByVersion.get(v.id) ?? 0,
  }));

  decorated.sort(
    (a, b) =>
      variantSortIndex(a.variant) - variantSortIndex(b.variant) ||
      a.versionNumber - b.versionNumber
  );

  return decorated;
}

/**
 * Default-version pick for first page load (no ?v= in URL).
 *
 * Locked rule (D87 brief Q-A): "most recently ACTIVE version of the
 * first variant (canonical display order). If a variant has no active
 * version, fall back to the most recent version of any status; don't
 * render blank."
 *
 * Algorithm:
 *   1. Iterate variants in canonical display order (variantSortIndex).
 *      The first variant with ANY version wins.
 *   2. Within that variant: prefer status='active' (the partial-unique
 *      `one_active_version_per_variant` index guarantees at most one);
 *      else fall back to the highest version_number row regardless of
 *      status.
 *   3. Returns null only when the versions list is empty (fresh DB) —
 *      the page renders the global empty state in that case.
 *
 * Pure; no I/O.
 */
export function pickDefaultVersionId(
  versions: AnalyticsVariantVersion[]
): string | null {
  if (versions.length === 0) return null;
  // Group by variant, preserving canonical-order traversal.
  const byVariant = new Map<string, AnalyticsVariantVersion[]>();
  for (const v of versions) {
    const list = byVariant.get(v.variant);
    if (list) list.push(v);
    else byVariant.set(v.variant, [v]);
  }
  // `versions` is already canonical-order-sorted by listAnalyticsVersions,
  // so the first key encountered via .keys() iteration is the first
  // canonical variant (Map preserves insertion order).
  for (const variant of byVariant.keys()) {
    const list = byVariant.get(variant)!;
    const active = list.find((v) => v.status === "active");
    if (active) return active.versionId;
    // No active row for this variant — highest version_number wins
    // (most recent draft/closed). list is version_number ASC, so last
    // element is highest.
    const fallback = list[list.length - 1];
    if (fallback) return fallback.versionId;
  }
  return null; // unreachable when versions.length > 0
}

// ─── pivot data for one version ──────────────────────────────────────

/**
 * Full pivot bundle for ONE (variant, version):
 *   - the version metadata (so the page can show variant label, version
 *     number, status chip),
 *   - the version's question rows (ordered by order_index ASC),
 *   - every submitted+active respondent's answer, grouped by
 *     question.id (the load-bearing UUID grouping key — see file
 *     header).
 *
 * Page renders one question at a time via the ?q= URL param; this fn
 * returns the FULL bundle so the question picker can show all questions
 * without per-pick refetches. The dataset is small (~11 questions × ~N
 * respondents per variant) — well under any meaningful page-render
 * budget.
 *
 * Returns null if the versionId doesn't exist (page redirects to the
 * default version in that case).
 */
export async function getPivotForVersion(
  supabase: SupabaseClient<Database>,
  versionId: string
): Promise<PivotData | null> {
  // 1. Version row.
  const { data: vRow, error: vErr } = await supabase
    .from("questionnaire_versions")
    .select(
      "id, variant, type, version_number, status, published_at, closed_at"
    )
    .eq("id", versionId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!vRow) return null;

  // 2. Questions for this version (ORDER BY order_index ASC; the editor
  //    pattern from lib/repos/questionnaires.ts:getQuestionsForVersion).
  //    We pull is_feedback so the page can label F-block questions
  //    distinctly from Q-block — useful when Sura is looking at a pilot
  //    variant that includes F1–F4.
  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select(
      "id, question_code, order_index, text_en, text_ar, is_feedback, is_required, visible_nationalities"
    )
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });
  if (qErr) throw qErr;
  const questions: PivotQuestion[] = (qRows ?? []).map((q) => ({
    questionId: q.id,
    questionCode: q.question_code,
    orderIndex: q.order_index,
    textEn: q.text_en,
    textAr: q.text_ar,
    isFeedback: q.is_feedback,
    isRequired: q.is_required,
    visibleNationalities:
      (q.visible_nationalities as Nationality[] | null) ?? null,
  }));

  // 3. Find invitations bound to this version → their submitted+active
  //    responses → their answers. Three reads, joined in memory.
  // Redacted view typing: PostgREST generates view columns as nullable
  // even when underlying base columns are NOT NULL (`id`, `category`).
  // Narrow to NOT-NULL `id` rows so the downstream Map / `.in()` calls
  // type-check cleanly.
  const { data: iRows, error: iErr } = await supabase
    .from("invitations_redacted")
    .select("id, ref_code, category, nationality")
    .eq("questionnaire_version_id", versionId);
  if (iErr) throw iErr;
  const invitations = (iRows ?? []).filter(
    (i): i is typeof i & { id: string } => i.id !== null
  );

  // Initialize the per-question buckets with empty arrays so questions
  // with zero answers still render their "no responses yet" state via a
  // present-but-empty Map entry.
  const answersByQuestionId = new Map<string, PivotAnswer[]>();
  for (const q of questions) answersByQuestionId.set(q.questionId, []);

  if (invitations.length === 0) {
    return {
      version: {
        versionId: vRow.id,
        variant: vRow.variant,
        type: vRow.type,
        versionNumber: vRow.version_number,
        status: vRow.status as VersionStatus,
        publishedAt: vRow.published_at,
        closedAt: vRow.closed_at,
        submittedCount: 0,
      },
      questions,
      answersByQuestionId,
    };
  }

  const invitationIds = invitations.map((i) => i.id);
  const invById = new Map(invitations.map((i) => [i.id, i] as const));

  // Responses bound to those invitations, SUBMITTED + ACTIVE only.
  // (D63: status='active' excludes withdrawn — matches feedback.ts.)
  const { data: rRows, error: rErr } = await supabase
    .from("responses")
    .select("id, invitation_id, language, submitted_at")
    .in("invitation_id", invitationIds)
    .eq("status", "active")
    .not("submitted_at", "is", null);
  if (rErr) throw rErr;
  const responses = rRows ?? [];
  const respById = new Map(responses.map((r) => [r.id, r] as const));

  // Submitted count for the version header.
  const submittedCount = responses.length;

  if (responses.length === 0) {
    return {
      version: {
        versionId: vRow.id,
        variant: vRow.variant,
        type: vRow.type,
        versionNumber: vRow.version_number,
        status: vRow.status as VersionStatus,
        publishedAt: vRow.published_at,
        closedAt: vRow.closed_at,
        submittedCount: 0,
      },
      questions,
      answersByQuestionId,
    };
  }

  // Answers for those responses. We don't pre-filter by question_id
  // because every answer row in scope belongs to one of this version's
  // questions (FK chain: response.invitation_id → invitation.version_id
  // → questions.version_id). The defensive idToCode-style skip is
  // unnecessary here — but we still guard against the off-chance of a
  // stray question_id not in the questions set (e.g. if a question was
  // ever moved between versions in a future migration).
  const validQuestionIds = new Set(questions.map((q) => q.questionId));
  const responseIds = responses.map((r) => r.id);

  const { data: aRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, question_id, answer_text")
    .in("response_id", responseIds);
  if (aErr) throw aErr;

  for (const a of aRows ?? []) {
    if (!validQuestionIds.has(a.question_id)) continue; // defensive
    const resp = respById.get(a.response_id);
    if (!resp || !resp.submitted_at) continue; // submitted-only (already filtered above)
    const inv = invById.get(resp.invitation_id);
    const entry: PivotAnswer = {
      responseId: resp.id,
      refCode: inv?.ref_code ?? "—",
      category: inv?.category ?? "—",
      nationality: (inv?.nationality as Nationality | null) ?? null,
      language: resp.language as "en" | "ar",
      answerText: a.answer_text ?? "",
      submittedAt: resp.submitted_at,
    };
    const list = answersByQuestionId.get(a.question_id);
    if (list) list.push(entry);
    // (no else — initializer above guarantees the bucket exists)
  }

  // Pre-sort each bucket newest-first (matches feedback.ts convention).
  for (const list of answersByQuestionId.values()) {
    list.sort((x, y) => y.submittedAt.localeCompare(x.submittedAt));
  }

  return {
    version: {
      versionId: vRow.id,
      variant: vRow.variant,
      type: vRow.type,
      versionNumber: vRow.version_number,
      status: vRow.status as VersionStatus,
      publishedAt: vRow.published_at,
      closedAt: vRow.closed_at,
      submittedCount,
    },
    questions,
    answersByQuestionId,
  };
}

// ─── shared variant ordering (canonical display order) ───────────────
//
// Duplicated from lib/repos/questionnaires.ts intentionally — we don't
// want analytics to import from the editor repo (the editor repo is
// owner-only-flavored; analytics is both-roles). The map is tiny and
// the canonical order is a stable D-decision (officials → researchers
// → donors → ngos for pilots, then mains in the same intra-category
// order, with officials split jordanian → syrian for mains). If this
// order ever changes, both copies must change in lockstep — a
// reasonable trade for the clean import boundary.

const VARIANT_ORDER: readonly string[] = [
  "pilot_officials",
  "pilot_researchers",
  "pilot_donors",
  "pilot_ngos",
  "main_officials_jordanian",
  "main_officials_syrian",
  "main_researchers",
  "main_donors",
  "main_ngos",
];

export function variantSortIndex(variant: string): number {
  const i = VARIANT_ORDER.indexOf(variant);
  return i === -1 ? VARIANT_ORDER.length : i;
}
