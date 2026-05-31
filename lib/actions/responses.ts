"use server";

// lib/actions/responses.ts
//
// Owner-only response actions.
//
// withdrawResponseAction (D63): owner gate → load response → terminal
// pre-check → submission precondition → load invitation (refCode) +
// consent (signed-at timestamp) → atomic UPDATE (status + withdrawn_at
// together; one statement; the DB CHECK
// `responses_withdrawn_state_consistent` enforces the invariant but the
// action doesn't lean on it as a sequencing crutch) → audit at 'alert'
// severity → return refCode + withdrawnAt.
//
// SOFT DELETE. The row is retained for audit; consent_records row
// survives (cryptographic proof of consent moment); audit_log row
// timestamps the withdrawal. Excluded from exports/dashboards/feedback
// via scattered `.eq("status", "active")` filters at every aggregating
// read site (lib/repos/dashboard.ts, lib/repos/feedback.ts, gate reads
// in lib/actions/invitations.ts).
//
// ERROR CODES ONLY here. Wording (e.g. the "revoke the invitation
// instead" guidance for `not_submitted`) lives in the component
// (WithdrawResponseButton.tsx) per the layered-message convention.
//
// AUTHENTICATED server client (carries the admin JWT) — RLS r_owner_update
// is the DB backstop. NEVER the service-role client.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getResponse } from "@/lib/repos/responses";
import { getInvitation } from "@/lib/repos/invitations";
import { getConsentForResponse } from "@/lib/repos/consent";
import { logAudit } from "@/lib/audit";

export type WithdrawResponseResult =
  | {
      ok: true;
      /** Invitation ref_code (audit-friendly identifier). */
      refCode: string;
      /** ISO timestamp written to responses.withdrawn_at. */
      withdrawnAt: string;
    }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "not_submitted"
        | "already_withdrawn"
        | "server";
    };

export async function withdrawResponseAction(
  responseId: string
): Promise<WithdrawResponseResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner —
  //    mirrors revokeInvitationAction's pattern; RLS r_owner_update is
  //    the DB backstop).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "response.withdraw.forbidden",
        resource: "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role, responseId },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Load the response. Non-PII; widened repo returns status +
  //    withdrawnAt as of D63.
  const response = await getResponse(supabase, responseId);
  if (!response) return { ok: false, error: "not_found" };

  // 3. Terminal-state pre-check. Idempotent: re-withdrawing returns the
  //    existing state so a stale UI tab gets a clean signal (matches
  //    revoke's `already_revoked` pattern; the component does
  //    router.refresh() on this code to resync).
  if (response.status === "withdrawn") {
    return { ok: false, error: "already_withdrawn" };
  }

  // 4. Submission precondition. Withdrawing an in-progress response is a
  //    category error — there's no submitted research artifact yet, only
  //    a partial draft. The component maps this to explicit guidance
  //    ("revoke the invitation instead — that locks their session and
  //    retains the draft").
  if (!response.submittedAt) {
    return { ok: false, error: "not_submitted" };
  }

  // 5. Load invitation (for refCode — audit resource + return value) and
  //    consent (for signed_at — audit metadata: chain-of-custody
  //    timestamp, NOT the signed name). Invitation should always exist
  //    (FK ON DELETE CASCADE means a parent-less response is impossible
  //    in steady state); a missing one is a defensive 'server' error.
  //    Consent is best-effort — every modern response has one, but
  //    historical pre-D9 data or an interrupted public flow could leave
  //    a gap; we tolerate it and omit consentSignedAt from metadata.
  const invitation = await getInvitation(supabase, response.invitationId);
  if (!invitation) {
    console.error(
      "[responses] withdraw: invitation not found",
      response.invitationId
    );
    return { ok: false, error: "server" };
  }
  const consent = await getConsentForResponse(supabase, responseId);

  // 6. ATOMIC UPDATE. Both columns in a single statement — the DB CHECK
  //    `responses_withdrawn_state_consistent` enforces the invariant
  //    that status='withdrawn' ⇔ withdrawn_at IS NOT NULL, but we write
  //    them together as a contract, not as a sequence that relies on
  //    the CHECK to catch ordering bugs. Postgres applies multi-column
  //    UPDATEs atomically at the row level.
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("responses")
    .update({ status: "withdrawn", withdrawn_at: nowIso })
    .eq("id", responseId);
  if (updateErr) {
    console.error("[responses] withdraw update failed", updateErr);
    return { ok: false, error: "server" };
  }

  // 7. Audit — severity='alert'. D63: this is the FIRST 'alert'-severity
  //    action in the codebase. The 'alert' tier was reserved for
  //    data-altering admin actions on submitted research data; revoke is
  //    'warn' because it's pre-data (locks the link before any answers
  //    exist). Withdraw operates on a fully submitted research artifact
  //    and removes it from analysis — first-use establishes the
  //    precedent. The actor identity is filled by tg_audit_log_fill_actor
  //    (20260519170003_functions.sql). Metadata is PII-free: ids +
  //    refCode + consent timestamp ONLY (NEVER the signed name).
  await logAudit(supabase, {
    action: "response.withdraw",
    resource: invitation.refCode,
    severity: "alert",
    metadata: {
      responseId: response.id,
      invitationId: response.invitationId,
      refCode: invitation.refCode,
      consentSignedAt: consent?.signedAt ?? null,
    },
  });

  return {
    ok: true,
    refCode: invitation.refCode,
    withdrawnAt: nowIso,
  };
}
