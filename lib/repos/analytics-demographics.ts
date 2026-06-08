// lib/repos/analytics-demographics.ts
//
// D88 — Read-aggregation for the demographics view
// (/admin/analytics/demographics). Sibling to lib/repos/analytics.ts
// (per-question pivot) and lib/repos/feedback.ts (pilot feedback);
// same shape — variant-scoped, both-roles, non-PII, in-memory join.
//
// ─── SCOPE LOCK ──────────────────────────────────────────────────────
//
// Single (variant, version) only. No cross-variant / cross-version
// pooling. Same scoping discipline as D87 — pilot scale barely matters
// today, but when main V2 ships, blending pilot + main respondents
// silently in a demographics overview would corrupt sample-composition
// reads.
//
// D90 — Revoked invitations are EXCLUDED from the cohort entirely
// (status filter at the SQL layer, see step 2 below). Revoke is an
// owner-driven terminal kill (off-funnel per lib/funnel-stages.ts),
// and the revoke action structurally blocks any active+submitted
// response on the invitation before terminating — so excluding
// revoked invitations cannot hide counted data, only stops them from
// seeding categoriesPresent with a phantom row. 'expired' is NOT
// excluded — expiration is time-driven and does not block submission,
// so an expired invitation can still carry a valid pre-expiration
// active submission; filtering it would hide real data. The
// asymmetry is intentional — full reasoning at the SELECT site.
//
// ─── PII / ROLE DISCIPLINE ───────────────────────────────────────────
//
// Same shape as lib/repos/analytics.ts (D87) — copied here, not
// extended:
//   - AUTHENTICATED server client (RLS applies); responses + answers +
//     questionnaire_versions are non-PII allow-list (both roles SELECT).
//   - Demographics come from invitations_redacted — the VIEW, never the
//     base table — and we select ONLY category / nationality /
//     preferred_language / id / questionnaire_version_id / started_at.
//     No PII column ever read.
//   - No PostgREST embeds onto the invitations base table. Joins done
//     in memory by Map.
//   - SUBMITTED-ONLY + ACTIVE-ONLY responses (matches feedback.ts and
//     D63 cross-cutting filter).
//
// BOTH ROLES: aggregate counts + stats — non-PII research data.
//
// ─── ADDITIVE-ONLY DISCIPLINE (D88 lock) ─────────────────────────────
//
// Does NOT modify lib/repos/dashboard.ts (which has overlapping
// patterns — global funnel counts, avgDuration, medianWords). The
// dashboard is GLOBAL; D88 is variant-scoped. Calling getDashboardData
// would apply the wrong filters. The patterns are deliberately copied
// — extraction to shared lib/stats.ts (median) + lib/variants.ts
// (VARIANT_ORDER) is a separate refactor D-number per Saeed's ruling,
// tracked in the standing backlog chip.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { computeActiveDurationMinutes } from "./responses";
import type { AnalyticsVariantVersion } from "./analytics";

type CategoryType = Database["public"]["Enums"]["category_type"];
type NationalityType = Database["public"]["Enums"]["nationality_type"];
type VersionStatus = Database["public"]["Enums"]["version_status"];

/** Canonical display order for the matrix rows. Subset of the 4-pilot
 *  enum; future main-study variants slot in by their own .category. */
const CATEGORY_ORDER: readonly CategoryType[] = [
  "officials",
  "researchers",
  "donors",
  "ngos",
];

/** Display order for the matrix columns. 'na' folds BOTH the enum
 *  value `not_applicable` AND SQL-null nationality into one bucket per
 *  D88 lock. The two cases share semantics for sample-composition
 *  reads ("nationality not gated for this category"). */
export type NationalityBucket = "jordanian" | "syrian" | "na";
const NATIONALITY_COLUMNS: readonly NationalityBucket[] = [
  "jordanian",
  "syrian",
  "na",
];

/** Single (row, column) of the matrix. */
export type DemographicsCell = {
  category: CategoryType;
  nationality: NationalityBucket;
  count: number;
};

/** The category × nationality matrix for the cohort.
 *
 *  D88 RENDER RULE: rows include only categories that the SELECTED
 *  variant actually contains (categoriesPresent), so we don't render
 *  structurally-impossible zeros (e.g. donors × syrian for an Officials
 *  variant). For an Officials variant, the Jordanian/Syrian columns
 *  carry the real split; for non-Officials variants those two columns
 *  are honestly empty and the N/A column carries the count. The N/A
 *  column ALWAYS renders (even when 0) so the table's column shape is
 *  stable across variants. */
export type DemographicsMatrix = {
  /** Categories with ≥1 invitation in scope (NOT ≥1 submitted response —
   *  presence of the row reflects the sampling design, not current
   *  participation). Ordered by CATEGORY_ORDER. */
  categoriesPresent: CategoryType[];
  /** category → nationality → count. categories with zero invitations
   *  are absent. nationalities are ALL three buckets (zero counts are
   *  present, not omitted). */
  cells: Map<CategoryType, Map<NationalityBucket, number>>;
  /** Total submitted-active responses across the cohort. Equals the sum
   *  of cells. */
  totalSubmitted: number;
};

/** Per-language submitted-response counts. */
export type LanguageCounts = {
  en: number;
  ar: number;
};

/** Min/median/mean/max for the active-engagement duration
 *  (D82 semantic — invitations.started_at → responses.submitted_at).
 *  `count` is the # of submitted responses for which a non-null
 *  duration could be computed. `excluded` is # with a null duration
 *  (one or both endpoints missing) — surfaced honestly per D82 rule,
 *  no fallback to consent-moment. */
export type DurationStats = {
  count: number;
  excluded: number;
  min: number | null;
  median: number | null;
  mean: number | null;
  max: number | null;
};

/** Min/median/mean/max for total words per submitted response (sum of
 *  answers.word_count, the GENERATED STORED column). Per-response not
 *  per-answer; words not characters (schema-aligned). */
export type WordStats = {
  count: number;
  min: number | null;
  median: number | null;
  mean: number | null;
  max: number | null;
};

export type DemographicsData = {
  version: AnalyticsVariantVersion;
  matrix: DemographicsMatrix;
  languageCounts: LanguageCounts;
  duration: DurationStats;
  words: WordStats;
};

// ─── stat helpers (local; duplicated from dashboard.ts per D88 lock) ─

/** Median of a non-empty sorted-or-unsorted number array; null when
 *  the array is empty. Duplicated from lib/repos/dashboard.ts:65
 *  intentionally — Saeed's D88 lock keeps this PR atomic. A future
 *  refactor D-number will extract dashboard.median +
 *  analytics-demographics.median → lib/stats.ts, alongside the
 *  VARIANT_ORDER extraction. The duplication is harmless today
 *  (identical + correct); if you change one, change both. */
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function min(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((m, n) => (n < m ? n : m), nums[0]);
}

function max(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((m, n) => (n > m ? n : m), nums[0]);
}

/** Initialize an empty matrix shell with zero-counts for every
 *  (category, nationality) combination, then narrow categoriesPresent
 *  later based on what the variant actually contains. */
function emptyMatrix(): DemographicsMatrix {
  const cells = new Map<CategoryType, Map<NationalityBucket, number>>();
  for (const cat of CATEGORY_ORDER) {
    const inner = new Map<NationalityBucket, number>();
    for (const nat of NATIONALITY_COLUMNS) inner.set(nat, 0);
    cells.set(cat, inner);
  }
  return { categoriesPresent: [], cells, totalSubmitted: 0 };
}

/** Map nullable nationality_type to the 3-column bucket the matrix
 *  uses. `not_applicable` and SQL-null fold into 'na' per D88 lock. */
function bucketize(
  nationality: NationalityType | null | undefined
): NationalityBucket {
  if (nationality === "jordanian") return "jordanian";
  if (nationality === "syrian") return "syrian";
  return "na"; // covers 'not_applicable' AND null
}

// ─── repo entrypoint ─────────────────────────────────────────────────

/**
 * Demographics bundle for one (variant, version): matrix + language
 * counts + duration stats + length stats. Single read pass joined in
 * memory — same pattern as lib/repos/analytics.ts:getPivotForVersion.
 *
 * Returns null when the versionId doesn't exist (page renders the
 * "version no longer exists" state). When the version exists but has
 * zero submitted+active responses, returns a fully-populated bundle
 * with empty matrix + zeroed stats — the page distinguishes
 * "no responses yet" vs "no version".
 */
export async function getDemographicsForVersion(
  supabase: SupabaseClient<Database>,
  versionId: string
): Promise<DemographicsData | null> {
  // 1. Version row — same shape D87 returns.
  const { data: vRow, error: vErr } = await supabase
    .from("questionnaire_versions")
    .select(
      "id, variant, type, version_number, status, published_at, closed_at"
    )
    .eq("id", versionId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!vRow) return null;

  const matrix = emptyMatrix();

  // 2. Invitations bound to this version, from the redacted view.
  //    `started_at` is the active-duration START milestone (set
  //    guard-once on first answer save; see D82 / responses.ts).
  //    PostgREST types view columns as nullable; narrow `id` defensively.
  //
  //    D90 — `.neq("status", "revoked")` excludes revoked invitations
  //    from the cohort entirely. Revoked is off-funnel (see
  //    lib/funnel-stages.ts:OffFunnelStatus) — a revoked invitation
  //    is owner-killed and no longer part of the active sample, so it
  //    must not seed categoriesPresent (the D88 bug DON-01 surfaced:
  //    a misassigned Donors invite on the Officials version injected
  //    a phantom Donors row). Safe at the SQL layer because:
  //
  //    (a) "revoke-after-submit" is structurally impossible —
  //        lib/actions/invitations.ts:revokeInvitationAction step 4
  //        unconditionally blocks revoke when any active+submitted
  //        response exists for the invitation (returns
  //        'already_submitted'). The only path to a revoked
  //        invitation that ever had a submission requires the response
  //        to be WITHDRAWN first (responses.status='withdrawn'), which
  //        is already excluded from this repo's `responses` query
  //        below via `.eq("status","active")`. Excluding the revoked
  //        invitation here cannot hide a counted submission.
  //
  //    (b) 'expired' is intentionally NOT excluded — expiration is
  //        time-driven and does NOT block submission, so an expired
  //        invitation can still carry a valid pre-expiration active
  //        submission. Filtering it here would hide real data. Revoke
  //        is the only off-funnel status with the action-layer
  //        submission block that makes this exclusion safe.
  const { data: iRows, error: iErr } = await supabase
    .from("invitations_redacted")
    .select("id, category, nationality, started_at")
    .eq("questionnaire_version_id", versionId)
    .neq("status", "revoked");
  if (iErr) throw iErr;
  const invitations = (iRows ?? []).filter(
    (i): i is typeof i & { id: string } => i.id !== null
  );

  // 3. Determine categoriesPresent from invitations (sampling design)
  //    — NOT from submitted responses. A category with invitations but
  //    zero submissions still merits a row (honest "0/N" signal). For
  //    current 4 pilot variants this is always one category; the
  //    deprecated `pilot_researchers_donors_ngos` (tombstone) would
  //    return multiple.
  const presentSet = new Set<CategoryType>();
  for (const inv of invitations) {
    if (inv.category) presentSet.add(inv.category);
  }
  matrix.categoriesPresent = CATEGORY_ORDER.filter((c) => presentSet.has(c));

  // 4. Submitted + active responses for those invitations.
  if (invitations.length === 0) {
    return {
      version: rowToVersion(vRow, 0),
      matrix,
      languageCounts: { en: 0, ar: 0 },
      duration: emptyDurationStats(),
      words: emptyWordStats(),
    };
  }
  const invIds = invitations.map((i) => i.id);
  const invById = new Map(invitations.map((i) => [i.id, i] as const));

  const { data: rRows, error: rErr } = await supabase
    .from("responses")
    .select("id, invitation_id, language, submitted_at")
    .in("invitation_id", invIds)
    .eq("status", "active")
    .not("submitted_at", "is", null);
  if (rErr) throw rErr;
  const responses = rRows ?? [];

  if (responses.length === 0) {
    return {
      version: rowToVersion(vRow, 0),
      matrix,
      languageCounts: { en: 0, ar: 0 },
      duration: emptyDurationStats(),
      words: emptyWordStats(),
    };
  }

  // 5. Per-response → invitation join, populating matrix + language
  //    counts + duration sample.
  const languageCounts: LanguageCounts = { en: 0, ar: 0 };
  const durations: number[] = [];
  let durationExcluded = 0;

  for (const r of responses) {
    const inv = invById.get(r.invitation_id);
    if (!inv) continue; // defensive: orphan response with no invitation match

    // Matrix bump.
    const cat = inv.category as CategoryType | null;
    if (cat) {
      const row = matrix.cells.get(cat);
      if (row) {
        const bucket = bucketize(inv.nationality as NationalityType | null);
        row.set(bucket, (row.get(bucket) ?? 0) + 1);
        matrix.totalSubmitted += 1;
      }
    }

    // Language counts.
    if (r.language === "en") languageCounts.en += 1;
    else if (r.language === "ar") languageCounts.ar += 1;

    // Duration (D82 semantic, per-response helper).
    const dur = computeActiveDurationMinutes(inv.started_at, r.submitted_at);
    if (dur === null) durationExcluded += 1;
    else durations.push(dur);
  }

  // 6. Word counts — per-response totals via the wordsByResponse Map
  //    pattern from dashboard.ts:187. Sum answers.word_count (the
  //    GENERATED STORED column, computed at write time and never
  //    re-computed at read).
  const responseIds = responses.map((r) => r.id);
  const { data: aRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, word_count")
    .in("response_id", responseIds);
  if (aErr) throw aErr;
  const wordsByResponse = new Map<string, number>();
  for (const a of aRows ?? []) {
    wordsByResponse.set(
      a.response_id,
      (wordsByResponse.get(a.response_id) ?? 0) + (a.word_count ?? 0)
    );
  }
  // Include responses with zero word_count rows (defensive: a submitted
  // response with no answers shouldn't happen given the submit gate,
  // but if it did, "0 words" is the honest signal — better than
  // omitting the response from the stat sample).
  const responseTotals: number[] = responses.map(
    (r) => wordsByResponse.get(r.id) ?? 0
  );

  return {
    version: rowToVersion(vRow, matrix.totalSubmitted),
    matrix,
    languageCounts,
    duration: {
      count: durations.length,
      excluded: durationExcluded,
      min: min(durations),
      median: median(durations),
      mean: mean(durations),
      max: max(durations),
    },
    words: {
      count: responseTotals.length,
      min: min(responseTotals),
      median: median(responseTotals),
      mean: mean(responseTotals),
      max: max(responseTotals),
    },
  };
}

// ─── shared helpers ──────────────────────────────────────────────────

function rowToVersion(
  r: {
    id: string;
    variant: string;
    type: string;
    version_number: number;
    status: string;
    published_at: string | null;
    closed_at: string | null;
  },
  submittedCount: number
): AnalyticsVariantVersion {
  return {
    versionId: r.id,
    variant: r.variant,
    type: r.type,
    versionNumber: r.version_number,
    status: r.status as VersionStatus,
    publishedAt: r.published_at,
    closedAt: r.closed_at,
    // Submitted+active count for THIS cohort — kept on the returned
    // version so the type doesn't lie. The page reads
    // matrix.totalSubmitted instead today, but a future caller that
    // grabs .version.submittedCount off this result needs an honest
    // value. Early-return paths (no invitations / no responses) pass
    // 0; the final-return path passes matrix.totalSubmitted.
    submittedCount,
  };
}

function emptyDurationStats(): DurationStats {
  return {
    count: 0,
    excluded: 0,
    min: null,
    median: null,
    mean: null,
    max: null,
  };
}

function emptyWordStats(): WordStats {
  return {
    count: 0,
    min: null,
    median: null,
    mean: null,
    max: null,
  };
}

/** Display labels for the nationality column headers — exported so
 *  the page renders consistent strings without coupling to the
 *  bucket value. 'na' renders as "N/A" with a tooltip explaining the
 *  fold per D88 footnote lock. */
export function nationalityColumnLabel(bucket: NationalityBucket): string {
  if (bucket === "jordanian") return "Jordanian";
  if (bucket === "syrian") return "Syrian";
  return "N/A";
}

/** Public so the page can iterate columns in display order. */
export const DEMOGRAPHICS_NATIONALITY_COLUMNS = NATIONALITY_COLUMNS;
