// lib/repos/dashboard.ts
//
// Read-aggregation for the admin Overview dashboard (Session 4 — admin
// dashboard). NON-PII and identity-free by construction:
//
//   - Invitation-derived stats (funnel, by-category, recent activity) read
//     `invitations_redacted` — the redacted VIEW, not the base table. The
//     view NULLs recipient_*_encrypted and omits token_hash, so PII can't
//     be reached even in principle; we additionally select only non-PII
//     columns. This sidesteps the 3c-i embed trap entirely (no PostgREST
//     embed onto the invitations base table, ever).
//   - Response/answer/tag stats read `responses`, `answers`,
//     `response_tags`→`tags` — all on the non-PII allow-list, both roles
//     SELECT. The response_tags→tags embed is safe (both non-PII; the trap
//     is specifically about PII *base* tables).
//
// NOTHING here selects recipient_name_encrypted / recipient_email_encrypted,
// and NOTHING decrypts. The dashboard shows ref_codes and counts only.
//
// EVERY aggregate is null-safe at 0 rows — the empty DB reads as
// "0 / 0% / — / no activity", which is intentional, not broken.
//
// Takes the authenticated server client so RLS applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type CategoryStat = {
  category: string;
  invited: number;
  submitted: number;
};

export type ActivityEvent = {
  refCode: string;
  label: string;
  at: string; // ISO timestamp
};

export type DashboardData = {
  // Funnel (status-based; invitation.status is maintained at each transition)
  invited: number;
  submitted: number;
  inProgress: number;
  completionPct: number; // 0 when invited === 0
  byCategory: CategoryStat[];
  recentActivity: ActivityEvent[];
  // At a glance (null = render "—")
  avgDurationMinutes: number | null;
  languages: ("en" | "ar")[];
  medianWords: number | null;
  avgWords: number | null;
  mostAppliedTag: string | null;
};

// The four categories always render, even at 0 invited (so the card isn't
// empty on a fresh DB). Order is display order.
const CATEGORIES: readonly string[] = [
  "officials",
  "researchers",
  "donors",
  "ngos",
];

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * One aggregate read for the whole dashboard. Each piece is independently
 * null-safe; a totally empty DB returns all zeros / nulls / empty arrays.
 *
 * D93 — `opts.versionIds` is the pilot/main scope filter (additive). When
 * a non-null array is passed, every figure is restricted to invitations
 * whose questionnaire_version_id is in that set (the caller resolves the
 * set from questionnaire_versions.type — pilot vs main). When null/omitted,
 * NO filter is applied (the "All studies" scope; preserves pre-D93 global
 * behavior). An empty array matches zero rows — the honest empty render
 * for a scope that has no versions yet. The filter lives on the FIRST
 * invitations query; responses are then narrowed by the scoped invitation
 * id set, and the answers + response_tags loops cascade through the
 * existing activeResponseIds Set, so no further query changes are needed.
 */
export async function getDashboardData(
  supabase: SupabaseClient<Database>,
  opts?: { versionIds?: string[] | null }
): Promise<DashboardData> {
  const versionIds = opts?.versionIds ?? null;

  // ---- Invitations (redacted view; non-PII columns only) --------------
  // D82 — `id` added to the SELECT so the responses → invitation join
  // for the active-duration computation below can match by primary key.
  // D93 — questionnaire_version_id added so the scope filter below can
  // narrow responses by the scoped invitation set; also the column the
  // .in() scope predicate targets. Non-PII; already in the redacted view.
  let invQuery = supabase
    .from("invitations_redacted")
    .select(
      "id, ref_code, category, status, sent_at, opened_at, started_at, submitted_at, questionnaire_version_id"
    );
  // D93 — scope filter. Null = no filter (All). Array (incl. empty) =
  // restrict to that version set.
  if (versionIds !== null) {
    invQuery = invQuery.in("questionnaire_version_id", versionIds);
  }
  const { data: invRows, error: invErr } = await invQuery;
  if (invErr) throw invErr;
  const invitations = invRows ?? [];

  // D98 — exclude 'pending' (bulk-created, not yet emailed) from the
  // "invited" cohort: a never-contacted row isn't invited. submitted /
  // inProgress already match only post-send statuses, so pending is
  // excluded there implicitly; this filter aligns the headline + the
  // completion denominator (and byCategory below).
  const contacted = invitations.filter((i) => i.status !== "pending");
  const invited = contacted.length;
  const submitted = contacted.filter((i) => i.status === "submitted").length;
  const inProgress = contacted.filter(
    (i) => i.status === "opened" || i.status === "started"
  ).length;
  const completionPct = invited > 0 ? Math.round((submitted / invited) * 100) : 0;

  const byCategory: CategoryStat[] = CATEGORIES.map((category) => {
    const inCat = contacted.filter((i) => i.category === category);
    return {
      category,
      invited: inCat.length,
      submitted: inCat.filter((i) => i.status === "submitted").length,
    };
  });

  // Recent activity: expand each non-null lifecycle timestamp into an event,
  // newest first. ref_code only — never a name.
  const events: ActivityEvent[] = [];
  for (const i of invitations) {
    const code = i.ref_code ?? "—";
    if (i.sent_at) events.push({ refCode: code, label: "Invitation sent", at: i.sent_at });
    if (i.opened_at) events.push({ refCode: code, label: "Invitation opened", at: i.opened_at });
    if (i.started_at) events.push({ refCode: code, label: "Response started", at: i.started_at });
    if (i.submitted_at) events.push({ refCode: code, label: "Response submitted", at: i.submitted_at });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const recentActivity = events.slice(0, 6);

  // ---- Responses (non-PII): avg duration + languages ------------------
  // D63 PARENT FILTER: only active responses count for any dashboard
  // aggregation. We also build `activeResponseIds` here — the Set is the
  // CASCADE BRIDGE for the answers + response_tags loops below, whose
  // queries don't join responses and would otherwise silently include
  // withdrawn responses' children in the word-count and tag-frequency
  // totals. ORDERING IS LOAD-BEARING: this query + Set MUST land before
  // either child loop runs. `id` is added to the select for the Set.
  //
  // D82 — added `invitation_id` to the SELECT so the duration loop below
  // can cross-reference invitations.started_at (the first-answer-save
  // moment) as the active-engagement start milestone, replacing the
  // broken responses.started_at (consent moment). The cascade-bridge
  // Set + word-count + tag-frequency loops below are unaffected.
  // D93 — when scoped, restrict responses to the scoped invitation set.
  // `invitations` is already narrowed to the scope above, so its ids are
  // the scoped set. Skip the predicate entirely when unscoped (All) to
  // preserve the pre-D93 global read. responses has no version_id column,
  // so invitation_id is the join key. The answers + response_tags loops
  // below cascade through activeResponseIds (built from this query), so
  // they inherit the scope automatically.
  let respQuery = supabase
    .from("responses")
    .select("id, invitation_id, started_at, submitted_at, language")
    .eq("status", "active");
  if (versionIds !== null) {
    const scopedInvIds = invitations
      .map((i) => i.id)
      .filter((id): id is string => id != null);
    respQuery = respQuery.in("invitation_id", scopedInvIds);
  }
  const { data: respRows, error: respErr } = await respQuery;
  if (respErr) throw respErr;
  const responses = respRows ?? [];
  const activeResponseIds = new Set(responses.map((r) => r.id));

  // D82 — index invitations.started_at by id so the duration loop below
  // pulls the ACTIVE-start milestone without re-querying. `invitations`
  // is already in scope from the redacted-view SELECT above; we now also
  // SELECT id (above) so the join key is available. invitations.started_at
  // is set guard-once by saveAnswer on first answer upsert (see
  // lib/actions/answers.ts) — the "first_answer_at" moment.
  const invStartedAtById = new Map<string, string | null>();
  for (const i of invitations) {
    if (i.id) invStartedAtById.set(i.id, i.started_at);
  }

  // D82 — duration semantic switched from (response.submitted_at -
  // response.started_at) [consent moment → submit] to (response.
  // submitted_at - invitation.started_at) [first-answer-save → submit].
  // The old formula was capturing CALENDAR time (production OFF-JOR-03 =
  // 2911 min / 48.5 hours) instead of ACTIVE engagement time. New
  // formula matches Sura's mental model: "how long did they spend
  // answering". Null start (legacy / pre-Session-2b) → row excluded
  // from the average (no fallback per D82 lock — '—' is the honest
  // signal).
  const durations: number[] = [];
  for (const r of responses) {
    if (!r.submitted_at) continue;
    const invStartedAt = invStartedAtById.get(r.invitation_id);
    if (!invStartedAt) continue;
    const ms =
      new Date(r.submitted_at).getTime() - new Date(invStartedAt).getTime();
    if (ms >= 0) durations.push(ms / 60000); // → minutes
  }
  const avgDurationMinutes =
    durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : null;

  const languages = Array.from(
    new Set(responses.map((r) => r.language))
  ).filter((l): l is "en" | "ar" => l === "en" || l === "ar");

  // ---- Answers (non-PII): per-response word totals → median + mean ----
  const { data: ansRows, error: ansErr } = await supabase
    .from("answers")
    .select("response_id, word_count");
  if (ansErr) throw ansErr;

  const wordsByResponse = new Map<string, number>();
  for (const a of ansRows ?? []) {
    // D63 CASCADE: skip answers whose parent response was withdrawn.
    // activeResponseIds is built from the parent query above; without
    // this guard, withdrawn responses' word counts leak into the totals.
    if (!activeResponseIds.has(a.response_id)) continue;
    wordsByResponse.set(
      a.response_id,
      (wordsByResponse.get(a.response_id) ?? 0) + (a.word_count ?? 0)
    );
  }
  const responseTotals = [...wordsByResponse.values()];
  const medianWords = median(responseTotals);
  const avgWords =
    responseTotals.length > 0
      ? Math.round(responseTotals.reduce((s, w) => s + w, 0) / responseTotals.length)
      : null;

  // ---- Most-applied tag (response_tags → tags; both non-PII) ----------
  // D63: `response_id` added to the select so the cascade guard below
  // can skip rows whose parent response was withdrawn.
  const { data: tagRows, error: tagErr } = await supabase
    .from("response_tags")
    .select("tag_id, response_id, tags(name)");
  if (tagErr) throw tagErr;

  const tagCounts = new Map<string, { name: string; count: number }>();
  for (const row of tagRows ?? []) {
    // D63 CASCADE: skip tags whose parent response was withdrawn (same
    // pattern as the answers loop above).
    if (!activeResponseIds.has(row.response_id)) continue;
    const name = row.tags?.name;
    if (!name) continue;
    const cur = tagCounts.get(row.tag_id);
    if (cur) cur.count += 1;
    else tagCounts.set(row.tag_id, { name, count: 1 });
  }
  let mostAppliedTag: string | null = null;
  let topCount = 0;
  for (const { name, count } of tagCounts.values()) {
    if (count > topCount) {
      topCount = count;
      mostAppliedTag = name;
    }
  }

  return {
    invited,
    submitted,
    inProgress,
    completionPct,
    byCategory,
    recentActivity,
    avgDurationMinutes,
    languages,
    medianWords,
    avgWords,
    mostAppliedTag,
  };
}
