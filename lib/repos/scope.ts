// lib/repos/scope.ts
//
// D93 — Overview-dashboard pilot/main SCOPE resolution.
//
// The /admin overview pools pilot + main data on every figure (funnel,
// stalled table, category bars, at-a-glance stats). Once a main variant
// is activated, an un-scoped number silently conflates two studies. This
// helper resolves a requested scope (?scope=pilot|main|all) into the
// version-id set that the dashboard repos filter on, plus the default
// when no scope is requested.
//
// QUERYABLE DISTINCTION: questionnaire_versions.type is the enum
// 'pilot' | 'main' (migration 20260519170001). Every invitation FKs a
// questionnaire_version_id, so resolving the set of version ids for a
// type and filtering invitations by .in("questionnaire_version_id", ids)
// is the scope mechanism. This is read-mostly + additive — the repos
// take the resolved set as an optional param (null = no filter = "All").
//
// DEFAULT (D93 b1): if ANY main variant has an active version, default to
// Main; else default to Pilot. "All" is NEVER the default — Sura must
// explicitly choose it to see a blended figure. Predictable over
// adaptive: once main is active, the default is Main, period (no
// most-recent-activity heuristic).
//
// NON-PII: questionnaire_versions carries no PII (id / type / status).
// Both admin roles SELECT it (RLS q_admins_select). The scope filter the
// repos apply targets questionnaire_version_id on invitations_redacted —
// also non-PII, already in the redacted view. No PII posture change.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type OverviewScope = "pilot" | "main" | "all";

export type ResolvedScope = {
  /** The effective scope after applying the default rule. */
  scope: OverviewScope;
  /** Version-id set the dashboard repos filter on. `null` for "all" —
   *  the repos treat null as "no filter applied". A scope with no
   *  versions yet resolves to an empty array → repos render zero rows
   *  (honest empty), not a crash. */
  versionIds: string[] | null;
  /** Whether any main variant currently has an active version. Drives the
   *  default and lets the page decide whether to surface the scope control
   *  at all (pre-main there's only pilot data, but we still show it so the
   *  control is discoverable). */
  anyMainActive: boolean;
};

/** Human label for each scope — used for the dynamic eyebrow / subtitle. */
export const SCOPE_LABEL: Record<OverviewScope, string> = {
  pilot: "Pilot",
  main: "Main study",
  all: "All studies",
};

/** Subtitle copy per scope (replaces the hardcoded pilot subtitle). */
export const SCOPE_SUBTITLE: Record<OverviewScope, string> = {
  pilot: "Real-time status of the pilot questionnaire round.",
  main: "Real-time status of the main study.",
  all: "Real-time status across pilot and main studies (blended).",
};

export function isOverviewScope(
  v: string | undefined
): v is OverviewScope {
  return v === "pilot" || v === "main" || v === "all";
}

/**
 * Resolve the requested scope into a version-id set + the effective scope
 * after the default rule. One read of questionnaire_versions serves both
 * the default determination and the per-scope id sets.
 *
 * `requested` is the raw ?scope= param (possibly undefined / invalid);
 * invalid values fall through to the default exactly like absence.
 */
export async function resolveOverviewScope(
  supabase: SupabaseClient<Database>,
  requested: string | undefined
): Promise<ResolvedScope> {
  const { data, error } = await supabase
    .from("questionnaire_versions")
    .select("id, type, status");
  if (error) throw error;
  const rows = data ?? [];

  const anyMainActive = rows.some(
    (r) => r.type === "main" && r.status === "active"
  );
  const pilotVersionIds = rows
    .filter((r) => r.type === "pilot")
    .map((r) => r.id);
  const mainVersionIds = rows
    .filter((r) => r.type === "main")
    .map((r) => r.id);

  // Default rule (b1): main-if-any-main-active, else pilot. Never "all".
  const scope: OverviewScope = isOverviewScope(requested)
    ? requested
    : anyMainActive
      ? "main"
      : "pilot";

  const versionIds =
    scope === "all"
      ? null
      : scope === "main"
        ? mainVersionIds
        : pilotVersionIds;

  return { scope, versionIds, anyMainActive };
}
