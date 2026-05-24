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
 * Most-recent audit events, newest first. Default cap of 100 keeps the page
 * bounded (pagination is a later concern — the table is near-empty in prod and
 * only real admin mutations write rows). AUTHENTICATED client; RLS
 * audit_log_owner_select restricts to owners.
 */
export async function listAuditEvents(
  supabase: SupabaseClient<Database>,
  opts: { limit?: number } = {}
): Promise<AuditEventView[]> {
  const limit = opts.limit ?? 100;
  const { data, error } = await supabase
    .from("audit_log")
    .select(AUDIT_COLS)
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToView);
}
