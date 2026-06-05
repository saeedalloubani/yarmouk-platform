// lib/email/reminder-manual.ts
//
// D79 Feature 3 — single-row manual reminder dispatcher. Sura's nudge
// surface, distinct from the daily cron at /api/cron/send-reminders.
//
// MIRRORS the cron's per-row pattern (decrypt → render → send) and reuses
// sendReminderEmail from lib/email/reminder.ts verbatim — the email body
// is byte-identical to what cron sends on Day 7/14, which is the point:
// the manual nudge and the auto-nudge are the same surface as far as the
// recipient sees.
//
// DIFFERENCES from cron's dispatchOne:
//   - Audit posture: writes a per-row SUCCESS row (invitation.reminder_manual,
//     severity=info) AND a per-row FAILURE row (invitation.reminder_manual.failed,
//     severity=warn). Cron writes only failures via logSystemEmailFailure.
//     Manual is a human-triggered action by Sura — every click is auditable
//     (and the rate-limit query needs success rows).
//   - Actor: authenticated server client (admin's JWT). Cron uses service-role.
//   - No column stamps: does NOT touch reminder1_sent_at / reminder_final_sent_at
//     (FLAG E — manual nudge does not suppress cron's future fire).
//   - No sent_at touch: preserve the cron's 7d/14d anchor exactly.
//   - No use_count touch: that's for token uses, not email sends.
//   - No last_send_failed_at touch: the per-row chip on /admin/invitations
//     surfaces cron + initial-send failures only; manual-reminder failures
//     surface via the redirect banner + the audit row (Sura sees both).
//
// PII discipline mirrors cron:
//   - Decrypted email, token plaintext, access code, and recipient name are
//     each scoped to THIS function — handed to sendReminderEmail and fall out
//     of scope at return. NEVER logged, NEVER in audit metadata.
//   - All console.error lines reference refCode + errorClass; NEVER recipient,
//     NEVER raw Resend error.message (which can echo recipient addresses),
//     NEVER token URL.
//   - Audit metadata is the minimal { invitationId, kind, triggeredBy:'manual' }
//     (success) or with errorClass added (failure). No decrypted fields.
//
// Locks the kind to "reminder1" — Sura's manual nudge always uses the
// reminder1 template. If she wants reminderFinal escalation later, that's
// a follow-on with a kind discriminator.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendReminderEmail } from "@/lib/email/reminder";
import { buildInvitationUrl } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";

export type ManualReminderResult =
  | { ok: true; refCode: string }
  | {
      ok: false;
      refCode: string;
      errorClass: "send" | "config" | "decrypt" | "not_found" | "ineligible";
    };

/**
 * Send a manual reminder1 to the recipient of `invitationId`.
 *
 * Pre-conditions enforced here (in addition to the route's owner-gate
 * and rate-limit checks):
 *   - Invitation exists and is in a non-terminal state (sent/opened/started).
 *   - All required ciphertexts (email, token_plaintext, access_code) decrypt
 *     successfully. Recipient name decrypt-failure is non-fatal (D72).
 *
 * On success: writes audit row + returns ok.
 * On failure: writes audit row with errorClass + returns ok=false.
 */
export async function sendManualReminder(
  supabase: SupabaseClient<Database>,
  invitationId: string
): Promise<ManualReminderResult> {
  // ── 1. Site URL pre-flight ────────────────────────────────────────
  // buildInvitationUrl reads NEXT_PUBLIC_SITE_URL each call. Verify it
  // here before doing any DB or decrypt work; throw maps to errorClass
  // 'config'.
  const siteCheck = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteCheck) {
    console.error(
      "[manual-reminder] NEXT_PUBLIC_SITE_URL missing errorClass=config"
    );
    await safeAuditFailure(supabase, invitationId, "REF?", "config");
    return { ok: false, refCode: "REF?", errorClass: "config" };
  }

  // ── 2. Fetch invitation row (base table; owner-only) ──────────────
  // We need the encrypted columns the redacted view masks. The route
  // already verified admin.role === 'owner' before calling us; RLS on
  // the base table additionally rejects non-owners. We select via the
  // base table here (not the repo) because the repo's role-branching
  // would return the masked view for any non-owner — but the route gate
  // ensures we ONLY reach here as owner, and reading base table is the
  // single source of truth for ciphertexts.
  const { data: inv, error: invErr } = await supabase
    .from("invitations")
    .select(
      "id, ref_code, preferred_language, status, expires_at, recipient_email_encrypted, recipient_name_encrypted, token_plaintext_encrypted, access_code_encrypted"
    )
    .eq("id", invitationId)
    .maybeSingle();
  if (invErr) {
    console.error(
      "[manual-reminder] invitation fetch failed errorClass=config"
    );
    await safeAuditFailure(supabase, invitationId, "REF?", "config");
    return { ok: false, refCode: "REF?", errorClass: "config" };
  }
  if (!inv) {
    return { ok: false, refCode: "REF?", errorClass: "not_found" };
  }

  const refCode = inv.ref_code;

  // ── 3. Eligibility gate ───────────────────────────────────────────
  // Manual reminder makes sense only for active, non-terminal rows. We
  // don't enforce "must be stalled" — Sura might want to nudge a row
  // that's freshly sent but hasn't been opened in a few hours. That's
  // her call; the rate limiter prevents spam.
  if (
    inv.status !== "sent" &&
    inv.status !== "opened" &&
    inv.status !== "started"
  ) {
    await safeAuditFailure(supabase, invitationId, refCode, "config", {
      reason: "ineligible_status",
      status: inv.status,
    });
    return { ok: false, refCode, errorClass: "ineligible" };
  }

  // Expiry: a reminder pointing at an expired link is worse than no
  // reminder. Skip — Sura should resend (rotation) if she wants to
  // revive the link.
  if (new Date(inv.expires_at).getTime() <= Date.now()) {
    await safeAuditFailure(supabase, invitationId, refCode, "config", {
      reason: "expired",
    });
    return { ok: false, refCode, errorClass: "ineligible" };
  }

  // ── 4. Decrypt required PII ──────────────────────────────────────
  // Email + token + access_code are REQUIRED. Name is OPTIONAL (D72).
  // Each ciphertext is scoped to this function; never logged, never
  // audited. Error metadata is the bucket only — never err.message.
  if (
    !inv.recipient_email_encrypted ||
    !inv.token_plaintext_encrypted ||
    !inv.access_code_encrypted
  ) {
    console.error(
      "[manual-reminder] missing required ciphertext for",
      refCode,
      "errorClass=config"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "config", {
      reason: "missing_ciphertext",
    });
    return { ok: false, refCode, errorClass: "config" };
  }

  const { data: emailPlain, error: emailErr } = await supabase.rpc(
    "decrypt_pii",
    { p_ciphertext: inv.recipient_email_encrypted }
  );
  if (emailErr || !emailPlain) {
    console.error(
      "[manual-reminder] decrypt(email) failed for",
      refCode,
      "errorClass=decrypt"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "decrypt");
    return { ok: false, refCode, errorClass: "decrypt" };
  }
  const { data: tokenPlain, error: tokenErr } = await supabase.rpc(
    "decrypt_pii",
    { p_ciphertext: inv.token_plaintext_encrypted }
  );
  if (tokenErr || !tokenPlain) {
    console.error(
      "[manual-reminder] decrypt(token) failed for",
      refCode,
      "errorClass=decrypt"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "decrypt");
    return { ok: false, refCode, errorClass: "decrypt" };
  }
  const { data: codePlain, error: codeErr } = await supabase.rpc(
    "decrypt_pii",
    { p_ciphertext: inv.access_code_encrypted }
  );
  if (codeErr || !codePlain) {
    console.error(
      "[manual-reminder] decrypt(access_code) failed for",
      refCode,
      "errorClass=decrypt"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "decrypt");
    return { ok: false, refCode, errorClass: "decrypt" };
  }

  // Name — non-fatal per D72. Degrade to null on failure.
  let namePlain: string | null = null;
  if (inv.recipient_name_encrypted) {
    const { data: nameDec, error: nameErr } = await supabase.rpc(
      "decrypt_pii",
      { p_ciphertext: inv.recipient_name_encrypted }
    );
    if (nameErr) {
      // Bucket only; error.message could echo PII in unusual states.
      // Reminder still sends with empty {name}.
      console.error(
        "[manual-reminder] decrypt(name) failed for",
        refCode,
        "errorClass=decrypt — degrading to empty {name} (non-fatal)"
      );
    } else if (typeof nameDec === "string") {
      namePlain = nameDec;
    }
  }

  // ── 5. Compose URL + dispatch ────────────────────────────────────
  let tokenUrl: string;
  try {
    tokenUrl = buildInvitationUrl(tokenPlain);
  } catch {
    // buildInvitationUrl throws only on missing NEXT_PUBLIC_SITE_URL.
    // The pre-flight at step 1 should have caught this — defensive.
    console.error(
      "[manual-reminder] buildInvitationUrl threw for",
      refCode,
      "errorClass=config"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "config");
    return { ok: false, refCode, errorClass: "config" };
  }

  let sendResult;
  try {
    sendResult = await sendReminderEmail({
      to: emailPlain,
      lang: inv.preferred_language as "en" | "ar",
      refCode,
      tokenUrl,
      expiresAt: inv.expires_at,
      kind: "reminder1",
      accessCode: codePlain,
      name: namePlain,
    });
  } catch {
    // Wrapper throws on missing RESEND_API_KEY.
    console.error(
      "[manual-reminder] wrapper threw for",
      refCode,
      "errorClass=config"
    );
    await safeAuditFailure(supabase, invitationId, refCode, "config");
    return { ok: false, refCode, errorClass: "config" };
  }

  if (!sendResult.ok) {
    console.error(
      "[manual-reminder] send failed for",
      refCode,
      "errorClass=" + sendResult.errorClass
    );
    await safeAuditFailure(
      supabase,
      invitationId,
      refCode,
      sendResult.errorClass
    );
    return { ok: false, refCode, errorClass: sendResult.errorClass };
  }

  // ── 6. Success audit ─────────────────────────────────────────────
  // Single source of truth for rate limiting + dashboard "last manual
  // nudged" display. logAudit auto-captures the actor (Sura's admin id)
  // via the BEFORE-INSERT trigger; we provide only the action +
  // resource + non-PII metadata.
  await logAudit(supabase, {
    action: "invitation.reminder_manual",
    resource: refCode,
    severity: "info",
    metadata: {
      invitationId,
      kind: "reminder1",
      triggeredBy: "manual",
    },
  });

  return { ok: true, refCode };
}

/**
 * Best-effort audit-failure write. Wrapped so a write hiccup never masks
 * the original failure path. Metadata is { invitationId, kind, errorClass,
 * triggeredBy } — NO PII. Optional extra fields are merged in
 * (e.g. reason='ineligible_status') for the rare eligibility branches.
 */
async function safeAuditFailure(
  supabase: SupabaseClient<Database>,
  invitationId: string,
  refCode: string,
  errorClass: "send" | "config" | "decrypt",
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await logAudit(supabase, {
      action: "invitation.reminder_manual.failed",
      resource: refCode,
      severity: "warn",
      metadata: {
        invitationId,
        kind: "reminder1",
        errorClass,
        triggeredBy: "manual",
        ...extra,
      },
    });
  } catch {
    // logAudit already console.error'd. Don't mask the original failure.
  }
}
