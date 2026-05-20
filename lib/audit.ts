// lib/audit.ts
//
// Admin-mutation audit logging (D54). Wraps the SECURITY DEFINER
// log_audit() RPC. The function runs as its owner so it can INSERT into
// audit_log (which has no authenticated INSERT policy), while auth.jwt()
// inside still resolves the CALLER — so the audit_log_fill_actor trigger
// snapshots the ACTING admin, not 'system'.
//
// MUST be called with the authenticated server client (carries the
// admin's JWT). NEVER put PII or a plaintext token in `metadata` —
// audit_log is Owner-readable but is still an operational/analytical
// surface; keep it to non-identifying context (codes, ids, roles).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./supabase/database.types";

type Severity = Database["public"]["Enums"]["event_severity"];

export type AuditEntry = {
  /** Dotted action name, e.g. "invitation.create". */
  action: string;
  /** Human-facing resource id, e.g. the ref_code. */
  resource?: string;
  /** Defaults to 'info'. Use 'warn'/'alert' for security events. */
  severity?: Severity;
  /** NON-PII context only — never the token, name, or email. */
  metadata?: Json;
};

/**
 * Append an admin-mutation audit row. Throws on RPC error: a
 * security-relevant mutation must not silently lose its audit row.
 * Callers invoke this AFTER the mutation succeeds (auditing a completed
 * action), so a near-impossible audit failure surfaces a loud error
 * rather than masking a gap.
 */
export async function logAudit(
  supabase: SupabaseClient<Database>,
  entry: AuditEntry
): Promise<void> {
  const { error } = await supabase.rpc("log_audit", {
    p_action: entry.action,
    p_resource: entry.resource ?? "",
    p_severity: entry.severity ?? "info",
    p_metadata: entry.metadata ?? {},
  });
  if (error) {
    console.error("[audit] log_audit failed", error);
    throw error;
  }
}
