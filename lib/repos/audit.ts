// lib/repos/audit.ts
//
// Read-side for `audit_log` (the write path is lib/audit.ts → log_audit RPC).
// Powers the owner-only Security page. audit_log is OWNER-readable (RLS
// audit_log_owner_select); a readonly admin gets zero rows by policy, so this
// helper is always called behind the page's owner-gate AND backed by RLS.
//
// audit_log is NOT on the PII-repo-required list (CONVENTIONS) — its content
// is non-identifying by construction (codes, ids, roles; never names/tokens,
// enforced at every logAudit call site). So we read straight via
// supabase.from(), no decrypt layer.
//
// We SELECT the operational columns plus ip / user_agent (now populated by
// D26 ① on every audited action; older pre-D26 rows simply read NULL).
// country / city remain omitted — geo resolution (D26 ③) is deferred, so those
// columns stay NULL and would render empty.
//
// Takes the AUTHENTICATED server client so RLS applies.
//
// D76 — filter surface added. listAuditEvents now accepts an AuditFilters
// shape (severity / from / to / action / actorId / resource ILIKE) and
// returns { rows, totalCount } so the page can render "Showing N of M".
// getAuditSummary returns the 3-severity breakdown for the chip strip via
// 3 parallel count-only round-trips. listDistinctActions feeds the action
// dropdown — sourced from data, not a hard-coded enum, so new actions
// (e.g. "export.responses" landing in D74) appear automatically.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../supabase/database.types";

type Severity = Database["public"]["Enums"]["event_severity"];
type AdminRole = Database["public"]["Enums"]["admin_role"];

export type AuditEventView = {
  id: string;
  ts: string; // ISO timestamp
  severity: Severity;
  actorName: string | null;
  actorRole: AdminRole | null;
  action: string; // dotted name, e.g. "invitation.create"
  resource: string; // human-facing id (ref_code); "" when none
  metadata: Json; // non-PII context object
  ip: string | null; // request IP (D26 ①); NULL on pre-D26 rows
  userAgent: string | null; // request UA (D26 ①); NULL on pre-D26 rows
};

/**
 * Filter shape consumed by listAuditEvents + getAuditSummary. All fields
 * optional; absent means "no constraint on this dimension". Keys are
 * camelCase; the column-name mapping lives inside the .eq()/.gte()/.ilike()
 * calls (actorId → actor_admin_id is the only rename). `from` / `to` are
 * full ISO timestamps — rolling windows (e.g. "last 24 hours") are resolved
 * to absolute timestamps by the page layer before they reach this repo, so
 * this repo stays pure-relational and clock-free.
 */
export type AuditFilters = {
  severity?: Severity;
  from?: string;
  to?: string;
  action?: string;
  actorId?: string;
  resource?: string;
};

export type AuditSummary = {
  total: number;
  info: number;
  warn: number;
  alert: number;
};

const AUDIT_COLS =
  "id, ts, severity, actor_name, actor_role, action, resource, metadata, ip, user_agent";

function rowToView(r: {
  id: string;
  ts: string;
  severity: Severity;
  actor_name: string | null;
  actor_role: AdminRole | null;
  action: string;
  resource: string;
  metadata: Json;
  ip: string | null;
  user_agent: string | null;
}): AuditEventView {
  return {
    id: r.id,
    ts: r.ts,
    severity: r.severity,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    resource: r.resource,
    metadata: r.metadata,
    ip: r.ip,
    userAgent: r.user_agent,
  };
}

/**
 * Most-recent matching audit events, newest first. Returns both the rows
 * (capped at opts.limit, default 250 per D76) AND the FULL filtered count
 * via Postgres `count: 'exact'` — caller renders "Showing N of M" using
 * both numbers. AUTHENTICATED client; RLS audit_log_owner_select restricts
 * to owners. All filters are applied at the QUERY layer so we never
 * transfer rows we won't render.
 *
 * The `severity` partial index (idx_audit_log_severity_warn) covers
 * 'warn' + 'alert' filters; severity='info' falls back to the ts index
 * + filter or a sequential scan, which is fine at audit_log size and
 * documented in DECISIONS.md D76.
 */
export async function listAuditEvents(
  supabase: SupabaseClient<Database>,
  filters: AuditFilters = {},
  opts: { limit?: number } = {}
): Promise<{ rows: AuditEventView[]; totalCount: number }> {
  const limit = opts.limit ?? 250;
  let q = supabase
    .from("audit_log")
    .select(AUDIT_COLS, { count: "exact" })
    .order("ts", { ascending: false })
    .limit(limit);
  if (filters.severity) q = q.eq("severity", filters.severity);
  if (filters.from) q = q.gte("ts", filters.from);
  if (filters.to) q = q.lte("ts", filters.to);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actorId) q = q.eq("actor_admin_id", filters.actorId);
  if (filters.resource) q = q.ilike("resource", `%${filters.resource}%`);
  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: (data ?? []).map(rowToView),
    totalCount: count ?? 0,
  };
}

/**
 * Severity breakdown for the filtered audit query — 3 parallel count-only
 * round-trips (head:true = no row payload). Used by the Security page
 * summary chips, which render the breakdown as drill-in feedback as
 * filters are applied.
 *
 * Drill-in semantics: when a `severity` filter is active, the chips for
 * the other two severities show 0 (skipped without a round-trip — the
 * count is 0 by definition under the active filter). When no severity
 * filter is set, all three counts run in parallel.
 */
export async function getAuditSummary(
  supabase: SupabaseClient<Database>,
  filters: AuditFilters
): Promise<AuditSummary> {
  const [info, warn, alert] = await Promise.all([
    countAuditBySeverity(supabase, filters, "info"),
    countAuditBySeverity(supabase, filters, "warn"),
    countAuditBySeverity(supabase, filters, "alert"),
  ]);
  return { total: info + warn + alert, info, warn, alert };
}

/**
 * Count audit_log rows matching `filters` AND `severity`, ignoring any
 * severity inside `filters`. Short-circuits to 0 when `filters.severity`
 * is set to a different value (drill-in semantics).
 */
async function countAuditBySeverity(
  supabase: SupabaseClient<Database>,
  filters: AuditFilters,
  severity: Severity
): Promise<number> {
  if (filters.severity && filters.severity !== severity) return 0;
  let q = supabase
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("severity", severity);
  if (filters.from) q = q.gte("ts", filters.from);
  if (filters.to) q = q.lte("ts", filters.to);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actorId) q = q.eq("actor_admin_id", filters.actorId);
  if (filters.resource) q = q.ilike("resource", `%${filters.resource}%`);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Distinct action names present in the audit log, sorted alphabetically.
 * Drives the action dropdown in the Security page filter form. The set
 * grows with each new D-number that wires an audit call — sourced from
 * data, not a hard-coded enum, so new actions ("export.responses" landing
 * in D74, etc.) appear automatically without a code change.
 *
 * Dedupe is client-side via Set — PostgREST has no DISTINCT keyword on
 * its REST API. At audit_log size (low hundreds of rows in the pilot
 * window, expected low thousands at main-study close) the bare action
 * scan is negligible and uses idx_audit_log_action for the ORDER BY.
 */
export async function listDistinctActions(
  supabase: SupabaseClient<Database>
): Promise<string[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("action")
    .order("action", { ascending: true });
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.action)));
}
