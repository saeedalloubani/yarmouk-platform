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

import { headers } from "next/headers";
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
  /**
   * Optional explicit IP / user-agent override. Normally unset — logAudit
   * auto-captures both from next/headers headers(). Pass these only from a
   * context where the request headers aren't the ones you want recorded.
   */
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Best-effort read of the caller's request IP + user-agent (D26 phase ①).
 * Safe from any Server Action / Route Handler — next/headers headers() is
 * request-scoped there. Wrapped in try/catch so a non-request context
 * degrades to nulls instead of throwing: audit capture must never break the
 * action it follows. IP = first hop of x-forwarded-for (the original client;
 * Vercel populates it), else x-real-ip. NOTE: an admin IP is operational
 * security context, NOT respondent PII — D26 is strictly admin-only.
 */
async function getRequestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    const ip =
      (xff ? xff.split(",")[0]?.trim() : null) || h.get("x-real-ip") || null;
    const userAgent = h.get("user-agent") || null;
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

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
  const meta = await getRequestMeta();
  const { error } = await supabase.rpc("log_audit", {
    p_action: entry.action,
    p_resource: entry.resource ?? "",
    p_severity: entry.severity ?? "info",
    p_metadata: entry.metadata ?? {},
    // RPC params are optional string (absent → SQL DEFAULT NULL). Collapse our
    // string|null to string|undefined so an absent header still lands as NULL.
    p_ip: entry.ip ?? meta.ip ?? undefined,
    p_user_agent: entry.userAgent ?? meta.userAgent ?? undefined,
  });
  if (error) {
    console.error("[audit] log_audit failed", error);
    throw error;
  }
}

/**
 * Record an email send failure from a SYSTEM context (no authenticated
 * admin). Used by:
 *   - lib/notifications.ts → 'response.submission_email_failed' from the
 *     respondent submit fan-out (service-role; respondent has no JWT).
 *   - /api/cron/send-reminders → 'invitation.email_failed' kind=reminder1
 *     / reminderFinal from the daily auto-nudge cron (service-role;
 *     cron has no actor).
 *
 * Mirrors logFailedLogin's defensive shape:
 *   - Service-role direct insert; the BEFORE-INSERT trigger stamps
 *     actor='system' (correct — there is no real actor).
 *   - NARROW action enum — callers cannot pass arbitrary strings, so the
 *     system-context audit channel stays a known-events-only surface.
 *   - severity hard-coded 'warn' (recoverable operational signal).
 *   - Best-effort: never throws. An audit-write hiccup must not block
 *     the respondent's redirect (submission path) or cron's next
 *     iteration (reminder path).
 *
 * `metadata` is caller-supplied but the caller MUST NOT include:
 *   - raw error.message (Resend's strings can echo recipient addresses)
 *   - recipient email address (PII)
 *   - the magic-link / token URL (one-time secret)
 *
 * The errorClass discipline lives in lib/email/types — callers funnel
 * Resend errors through { ok: false, errorClass: 'send' | 'config' }
 * and only the bucket name reaches metadata.
 */
export async function logSystemEmailFailure(
  action: "invitation.email_failed" | "response.submission_email_failed",
  opts: {
    resource: string;
    metadata: Json;
  }
): Promise<void> {
  try {
    const { ip, userAgent } = await getRequestMeta();
    const { createSupabaseAdminClient } = await import("./supabase/admin");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      action,
      resource: opts.resource,
      severity: "warn",
      ip,
      user_agent: userAgent,
      metadata: opts.metadata,
    });
    if (error)
      console.error("[audit] logSystemEmailFailure insert failed", error);
  } catch (err) {
    console.error("[audit] logSystemEmailFailure threw", err);
  }
}

/**
 * Record a FAILED admin sign-in attempt (D26 phase ②). There is NO
 * authenticated session here, so this CANNOT use the authenticated log_audit
 * RPC (granted to `authenticated` only; the fill-actor trigger would resolve
 * no JWT). It writes directly via the SERVICE-ROLE client, which bypasses
 * RLS; the BEFORE-INSERT trigger still stamps ts + actor='system' (correct —
 * there is no real actor).
 *
 * DELIBERATELY NARROW — this is the ONLY unauthenticated audit-write path and
 * must stay a failed-login channel, not a general one:
 *   - the action is HARD-CODED ("admin.login.failed"); callers cannot pass an
 *     arbitrary action / severity / resource / metadata;
 *   - the service-role client is imported DYNAMICALLY and used only inside
 *     this function (admin.ts is server-only — it THROWS if pulled into a
 *     client bundle), so the rest of lib/audit.ts never touches the key;
 *   - NO email is recorded — a failed verifyOtp yields only an opaque
 *     token_hash, never the attempted address; we do NOT fabricate one.
 *
 * Best-effort: fully wrapped so an audit-write hiccup can NEVER block the
 * auth-failure redirect that follows it. (Contrast logAudit, which throws —
 * there the mutation already succeeded, so a lost audit row should be loud.)
 */
export async function logFailedLogin(
  reason: "verify_failed" | "missing_params"
): Promise<void> {
  try {
    const { ip, userAgent } = await getRequestMeta();
    const { createSupabaseAdminClient } = await import("./supabase/admin");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      action: "admin.login.failed",
      severity: "warn",
      ip,
      user_agent: userAgent,
      metadata: { reason },
    });
    if (error) console.error("[audit] logFailedLogin insert failed", error);
  } catch (err) {
    console.error("[audit] logFailedLogin threw", err);
  }
}
