"use server";

// lib/actions/invitations.ts
//
// Owner-only invitation actions.
//
// createInvitationAction (3b-i + 3b-ii send-at-create): owner gate →
// validate → mint token (D44) → guard URL → encrypt PII → insert → audit
// → optionally email (D55) → return the one-time token URL (D53).
//
// resendInvitationAction (3b-ii): owner gate → response-aware reset (D56)
// → mint new token → rotate token_hash (old link dies) → email → audit.
//
// PII/token handling: the plaintext token is returned ONCE and never
// stored/logged/placed in a URL. Name + email are encrypted in the DB via
// encrypt_pii (granted to authenticated; the owner's server client calls
// it — no service-role needed). The recipient address + token URL never
// appear in audit metadata or logs.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  createInvitation,
  getInvitation,
  updateInvitation,
} from "@/lib/repos/invitations";
import {
  mintInvitationToken,
  buildInvitationUrl,
  generateAccessCode,
} from "@/lib/tokens";
import { sendInvitationEmail } from "@/lib/email/invitation";
import type { EmailErrorClass } from "@/lib/email/types";
import { logAudit } from "@/lib/audit";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// D64 — record a Resend send failure on an invitation row + audit log.
//
// Two best-effort writes (each independently wrapped — we're in an
// error-recovery path, so a column-or-audit hiccup must not mask the
// underlying send issue from the operator):
//
//   1. invitations.last_send_failed_at = NOW() — drives the "send failed"
//      chip on /admin/invitations. Cleared on the next ok send from
//      the same row by the success path.
//   2. audit_log entry — severity='warn', errorClass-bucketed metadata.
//      NEVER carries raw error.message (Resend's strings can echo the
//      recipient address) or recipient/token data.
//
// Used by createInvitationAction (kind='invitation') and
// resendInvitationAction (kind='resend'). The cron route uses a parallel
// service-role helper (lib/audit.ts logSystemEmailFailure +
// updateInvitation via service-role) because it has no admin JWT.
async function recordInvitationSendFailure(
  supabase: SupabaseClient<Database>,
  args: {
    invitationId: string;
    refCode: string;
    kind: "invitation" | "resend";
    errorClass: EmailErrorClass;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await updateInvitation(supabase, args.invitationId, {
      lastSendFailedAt: nowIso,
    });
  } catch (colErr) {
    console.error(
      "[invitations] last_send_failed_at write failed for",
      args.refCode,
      colErr
    );
  }
  try {
    await logAudit(supabase, {
      action: "invitation.email_failed",
      resource: args.refCode,
      severity: "warn",
      metadata: {
        invitationId: args.invitationId,
        kind: args.kind,
        errorClass: args.errorClass,
      },
    });
  } catch (auditErr) {
    console.error(
      "[invitations] email_failed audit write failed for",
      args.refCode,
      auditErr
    );
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().regex(EMAIL_RE, "A valid email is required"),
  category: z.enum(["officials", "researchers", "donors", "ngos"]),
  nationality: z.enum(["jordanian", "syrian", "not_applicable"]),
  preferredLanguage: z.enum(["en", "ar"]),
  collectionMode: z.enum(["self_completed", "interview"]).default("self_completed"),
  refCode: z
    .string()
    .trim()
    .min(1, "Ref code is required")
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, digits, and dashes only"),
  questionnaireVersionId: z
    .string()
    .regex(UUID_RE, "Pick a questionnaire version"),
  expiresAt: z
    .string()
    .refine(
      (s) => !Number.isNaN(Date.parse(s)) && new Date(s) > new Date(),
      "Expiry must be a future date"
    ),
  maxUses: z.number().int().min(1, "Max uses must be at least 1"),
  sendEmail: z.boolean(),
});

// Loose form shape (strings for the enum selects); zod narrows it.
export type NewInvitationInput = {
  name: string;
  email: string;
  category: string;
  nationality: string;
  preferredLanguage: string;
  /** Optional from callers until the create-form UI sends it; the zod schema
   *  defaults an omitted value to "self_completed" (matches the DB column +
   *  repo default). */
  collectionMode?: string;
  refCode: string;
  questionnaireVersionId: string;
  expiresAt: string;
  maxUses: number;
  sendEmail: boolean;
};

export type CreateInvitationResult =
  | {
      ok: true;
      refCode: string;
      tokenUrl: string;
      /** D66 — 6-digit participant access code (plaintext). Shown ONCE
       *  on the create success page alongside the tokenUrl. Not
       *  recoverable from the DB after the response is consumed —
       *  invitations.access_code_encrypted is Vault-encrypted at rest
       *  and there is no decrypt path from the admin UI. To re-issue,
       *  use Resend (which mints a new code AND a new token). */
      accessCode: string;
      emailed: boolean;
    }
  | {
      ok: false;
      error: "forbidden" | "validation" | "ref_code_taken" | "server";
      issues?: string[];
    };

export async function createInvitationAction(
  input: NewInvitationInput
): Promise<CreateInvitationResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate — primary clean failure; RLS invitations_owner_all is
  //    the DB backstop. A readonly admin reaching here is exactly the
  //    security event the audit log exists for — record it (warn) before
  //    refusing. If there's NO session/admin at all, that's the route
  //    guard's job, not an admin-mutation attempt, so skip the audit.
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "invitation.create.forbidden",
        resource: typeof input?.refCode === "string" ? input.refCode : "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Validate.
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }
  const v = parsed.data;

  // 3. Mint (D44 token + D66 access code). Plaintexts exist only here +
  //    in the return value. Both are Vault-encrypted before the DB
  //    insert; the plaintexts go into the email body (URL + code) and
  //    are surfaced ONCE on the create success page for manual hand-off.
  const { plaintext, hash } = mintInvitationToken();
  const accessCodePlaintext = generateAccessCode();

  // 3.5. Build + guard the link BEFORE any write — a missing
  //      NEXT_PUBLIC_SITE_URL fails here, before we create an invitation
  //      we couldn't link to (or email). buildInvitationUrl throws; we
  //      convert it to a clean typed error (the throw is logged).
  let tokenUrl: string;
  try {
    tokenUrl = buildInvitationUrl(plaintext);
  } catch (err) {
    console.error("[invitations] buildInvitationUrl failed", err);
    return { ok: false, error: "server" };
  }

  // 4. Encrypt PII via the owner's authenticated client.
  //
  // D64 — third encrypt_pii call: the plaintext invitation TOKEN. Stored
  // alongside token_hash so the reminder cron (D64 STEP 7) can decrypt +
  // reuse the same URL without rotating the token (Path B locked).
  // Without this, reminders would have to rotate (killing the original
  // invitation email's link).
  //
  // D66 — fourth encrypt_pii call: the 6-digit ACCESS CODE. Stored so
  //   (a) validate_invitation_code can brute-decrypt-scan to find the
  //       row when a recipient types the code at /enter, and
  //   (b) the reminder cron can decrypt + include it in reminder1 /
  //       reminderFinal bodies (URL-prefetch fallback parity).
  // Four Vault encrypts in a row keeps all create-time PII handling
  // co-located. NEVER logged or returned (except the plaintext code in
  // the typed result for the shown-once admin UI panel).
  const { data: nameEnc, error: e1 } = await supabase.rpc("encrypt_pii", {
    p_plaintext: v.name,
  });
  const { data: emailEnc, error: e2 } = await supabase.rpc("encrypt_pii", {
    p_plaintext: v.email.toLowerCase(),
  });
  const { data: tokenEnc, error: e3 } = await supabase.rpc("encrypt_pii", {
    p_plaintext: plaintext,
  });
  const { data: accessCodeEnc, error: e4 } = await supabase.rpc(
    "encrypt_pii",
    { p_plaintext: accessCodePlaintext }
  );
  if (e1 || e2 || e3 || e4 || !nameEnc || !emailEnc || !tokenEnc || !accessCodeEnc) {
    console.error(
      "[invitations] encrypt_pii failed",
      e1 ?? e2 ?? e3 ?? e4
    );
    return { ok: false, error: "server" };
  }

  // 5. Insert, THEN audit. ORDERING IS DELIBERATE: logAudit fires AFTER
  //    the insert succeeds (we audit a COMPLETED mutation), and these are
  //    two separate statements, NOT one transaction — on purpose. A
  //    failed audit must NOT roll back a successfully minted invitation.
  //    The near-impossible throw-after-commit half-state (invitation
  //    exists, server error returned, retry blocked by the ref_code 23505)
  //    is preferable to an audit hiccup silently discarding a minted
  //    credential. Do NOT "fix" this by wrapping both in a transaction.
  let createdId = "";
  try {
    const invitation = await createInvitation(supabase, {
      tokenHash: hash,
      tokenPlaintextEncrypted: tokenEnc,
      accessCodeEncrypted: accessCodeEnc, // D66
      refCode: v.refCode,
      recipientNameEncrypted: nameEnc,
      recipientEmailEncrypted: emailEnc,
      category: v.category,
      nationality: v.nationality,
      preferredLanguage: v.preferredLanguage,
      collectionMode: v.collectionMode,
      questionnaireVersionId: v.questionnaireVersionId,
      expiresAt: new Date(v.expiresAt).toISOString(),
      maxUses: v.maxUses,
      createdBy: admin.id,
    });
    createdId = invitation.id;

    await logAudit(supabase, {
      action: "invitation.create",
      resource: v.refCode,
      severity: "info",
      metadata: {
        category: v.category,
        nationality: v.nationality,
        collectionMode: v.collectionMode,
        questionnaireVersionId: v.questionnaireVersionId,
        invitationId: invitation.id,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") return { ok: false, error: "ref_code_taken" };
    if (code === "23503") {
      return {
        ok: false,
        error: "validation",
        issues: ["That questionnaire version no longer exists"],
      };
    }
    console.error("[invitations] create failed", err);
    return { ok: false, error: "server" };
  }

  // 6. Optional send-at-create (D55). We HAVE the plaintext email here
  //    (v.email) — no decrypt needed; that's only for resend. Separate try
  //    so an email-config throw (missing RESEND_API_KEY) can't masquerade
  //    as a create failure: the invitation already exists. Email failure
  //    is BENIGN — the URL below is shown for manual hand-off.
  let emailed = false;
  if (v.sendEmail) {
    try {
      const sent = await sendInvitationEmail({
        to: v.email.toLowerCase(),
        lang: v.preferredLanguage,
        refCode: v.refCode,
        tokenUrl,
        expiresAt: new Date(v.expiresAt).toISOString(),
        accessCode: accessCodePlaintext, // D66
      });
      emailed = sent.ok;
      if (sent.ok) {
        await logAudit(supabase, {
          action: "invitation.email_sent",
          resource: v.refCode,
          severity: "info",
          metadata: { invitationId: createdId },
        });
        // D64 latent-bug fix: stamp invitations.sent_at so the reminder
        // cron has an anchor for its 7d / 14d thresholds. Inline
        // `new Date()` lands within microseconds of the audit row's
        // BEFORE-INSERT trigger timestamp.
        //
        // D64 — also clear lastSendFailedAt: a row that previously
        // failed but just succeeded should not keep its chip. "Clear on
        // next ok send" lifecycle.
        await updateInvitation(supabase, createdId, {
          sentAt: new Date().toISOString(),
          lastSendFailedAt: null,
        });
      } else {
        // D64 — Resend-layer failure (or wrapper config gate, e.g.
        // missing locale defaults). errorClass buckets the failure;
        // recordInvitationSendFailure writes badge + audit.
        await recordInvitationSendFailure(supabase, {
          invitationId: createdId,
          refCode: v.refCode,
          kind: "invitation",
          errorClass: sent.errorClass,
        });
      }
    } catch {
      // D64 — wrapper-throw path (only documented throw is missing
      // RESEND_API_KEY → config). Drop the error object from the log
      // (its toString could echo recipient under some Resend SDK
      // failure modes); badge + audit so a deploy misconfig still
      // surfaces in /admin/invitations and the audit log.
      console.error(
        "[invitations] send-at-create email threw for",
        v.refCode,
        "errorClass=config"
      );
      await recordInvitationSendFailure(supabase, {
        invitationId: createdId,
        refCode: v.refCode,
        kind: "invitation",
        errorClass: "config",
      });
    }
  }

  // 7. One-time token URL (D53) + one-time access code (D66) — both
  //    shown once on the admin success page; neither is recoverable
  //    from the DB. Resend mints fresh values.
  return {
    ok: true,
    refCode: v.refCode,
    tokenUrl,
    accessCode: accessCodePlaintext,
    emailed,
  };
}

// ---------------------------------------------------------------------------
// resendInvitationAction — owner-only token rotation + re-send (3b-ii, D56)
// ---------------------------------------------------------------------------

export type ResendInvitationResult =
  | {
      ok: true;
      refCode: string;
      tokenUrl: string;
      /** D66 — fresh 6-digit code minted by this resend. Shown ONCE on
       *  the resend success panel alongside the tokenUrl. The PREVIOUS
       *  code (if any) is dead the instant access_code_encrypted is
       *  overwritten in the rotation UPDATE — symmetric with the URL
       *  token's rotation semantic. */
      accessCode: string;
      emailed: boolean;
      mode: "resume" | "fresh";
    }
  | {
      ok: false;
      error: "forbidden" | "not_found" | "already_submitted" | "server";
    };

export async function resendInvitationAction(
  invitationId: string
): Promise<ResendInvitationResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "invitation.resend.forbidden",
        resource: "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role, invitationId },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Load the invitation (owner repo path → ciphertext email available).
  const inv = await getInvitation(supabase, invitationId);
  if (!inv || !inv.recipientEmailEncrypted) {
    return { ok: false, error: "not_found" };
  }

  // 3. Response-aware reset branch (D56) — read responses, the source of
  //    truth (not invitations.status). Submitted → block (a new link would
  //    be dead-on-arrival: validate rejects on submitted_at regardless of
  //    token). In-progress → resume re-send (preserve work). None → fresh.
  //    D63: both reads filter to status='active' — a withdrawn response
  //    no longer represents research data, so it shouldn't gate resend.
  //    Withdraw-then-resend re-opens the invitation slot intentionally
  //    (D63 decision). The audit chain — response.withdraw at 'alert' +
  //    the subsequent invitation.resend — preserves the full history.
  //    To prevent re-use after a withdraw, follow with revoke.
  const { data: submittedRows, error: subErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
    .eq("status", "active")
    .not("submitted_at", "is", null)
    .limit(1);
  if (subErr) {
    console.error("[invitations] resend responses(submitted) read failed", subErr);
    return { ok: false, error: "server" };
  }
  if ((submittedRows ?? []).length > 0) {
    return { ok: false, error: "already_submitted" };
  }

  const { data: inProgressRows, error: ipErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
    .eq("status", "active")
    .is("submitted_at", null)
    .limit(1);
  if (ipErr) {
    console.error("[invitations] resend responses(in-progress) read failed", ipErr);
    return { ok: false, error: "server" };
  }
  const inProgress = (inProgressRows ?? []).length > 0;

  // 4. Mint + guard the new link BEFORE the rotation, so a missing
  //    NEXT_PUBLIC_SITE_URL leaves the OLD link alive. D66 — also mint
  //    a fresh access code; rotation is symmetric (URL + code both
  //    rotate, or neither does, so the recipient never has a working
  //    URL and a dead code or vice versa).
  const { plaintext, hash } = mintInvitationToken();
  const accessCodePlaintext = generateAccessCode();
  let tokenUrl: string;
  try {
    tokenUrl = buildInvitationUrl(plaintext);
  } catch (err) {
    console.error("[invitations] buildInvitationUrl failed (resend)", err);
    return { ok: false, error: "server" };
  }

  // D64 — encrypt the new plaintext via Vault so the reminder cron can
  // decrypt + reuse the URL without rotating again. Mirrors create-time
  // step 4. Encrypt BEFORE the rotation commit (step 5): if encrypt
  // fails, the OLD link is still alive and the action surfaces a clean
  // server error.
  //
  // D66 — also encrypt the new access code. Both ciphertexts land in
  // the rotation UPDATE below, atomic at the row level. If the access-
  // code encrypt fails, the OLD URL + code stay alive — fail-safe.
  const { data: tokenEnc, error: tokenEncErr } = await supabase.rpc(
    "encrypt_pii",
    { p_plaintext: plaintext }
  );
  if (tokenEncErr || !tokenEnc) {
    console.error(
      "[invitations] resend encrypt_pii(token) failed",
      tokenEncErr
    );
    return { ok: false, error: "server" };
  }
  const { data: accessCodeEnc, error: accessCodeEncErr } = await supabase.rpc(
    "encrypt_pii",
    { p_plaintext: accessCodePlaintext }
  );
  if (accessCodeEncErr || !accessCodeEnc) {
    console.error(
      "[invitations] resend encrypt_pii(access_code) failed",
      accessCodeEncErr
    );
    return { ok: false, error: "server" };
  }

  const newExpiry = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  // 5. ── ROTATION COMMITS HERE ── the old link dies the instant token_hash
  //    is overwritten. Resume re-send keeps use_count/status/opened_at so
  //    the new link resumes the in-progress response via validate's
  //    resumption path; fresh re-send resets to a clean, claimable state.
  //
  //    D64 — tokenPlaintextEncrypted MUST be written together with
  //    tokenHash on EVERY rotation, so the column stays in sync with the
  //    live hash. The reminder cron decrypts this column to compose its
  //    CTA URL — a stale encrypted blob (pointing at the old hash)
  //    would cause reminders to send a dead URL.
  try {
    if (inProgress) {
      // D63/D56 resume branch — preserve the in-progress response by
      // keeping use_count/status/opened_at. D66 — rotate the access
      // code in lockstep with the token (the OLD code dies the
      // instant access_code_encrypted is overwritten). DO NOT reset
      // access_code_used_at — if the recipient previously fresh-claimed
      // via /enter, that forensic stamp stays attributable.
      await updateInvitation(supabase, inv.id, {
        tokenHash: hash,
        tokenPlaintextEncrypted: tokenEnc,
        accessCodeEncrypted: accessCodeEnc, // D66
        expiresAt: newExpiry,
      });
    } else {
      // D56 fresh branch — reset to a clean claimable state. D66 —
      // rotate the access code AND null access_code_used_at: the new
      // code has never been used.
      await updateInvitation(supabase, inv.id, {
        tokenHash: hash,
        tokenPlaintextEncrypted: tokenEnc,
        accessCodeEncrypted: accessCodeEnc, // D66
        accessCodeUsedAt: null, // D66 — fresh start
        expiresAt: newExpiry,
        status: "sent",
        useCount: 0,
        openedAt: null,
      });
    }
  } catch (err) {
    console.error("[invitations] resend rotation update failed", err);
    return { ok: false, error: "server" };
  }

  // 6. Decrypt the recipient address (resend has no plaintext email, unlike
  //    create) and send. The address is used transiently — never logged,
  //    never in audit metadata.
  const { data: email, error: dErr } = await supabase.rpc("decrypt_pii", {
    p_ciphertext: inv.recipientEmailEncrypted,
  });
  let emailed = false;
  if (dErr || !email) {
    console.error("[invitations] resend decrypt_pii failed", dErr);
    // D64 — decrypt failure prevents the send entirely. Surface as
    // 'config' (vault / key issue, not a Resend layer failure).
    await recordInvitationSendFailure(supabase, {
      invitationId: inv.id,
      refCode: inv.refCode,
      kind: "resend",
      errorClass: "config",
    });
  } else {
    // D64 — try/catch added so a wrapper-throw (missing RESEND_API_KEY)
    // doesn't escape the action and leave the caller with a rotated
    // token AND no audit/badge. Pre-D64 this could propagate out.
    try {
      const sent = await sendInvitationEmail({
        to: email,
        lang: inv.preferredLanguage,
        refCode: inv.refCode,
        tokenUrl,
        expiresAt: newExpiry,
        accessCode: accessCodePlaintext, // D66
      });
      emailed = sent.ok;
      if (!sent.ok) {
        await recordInvitationSendFailure(supabase, {
          invitationId: inv.id,
          refCode: inv.refCode,
          kind: "resend",
          errorClass: sent.errorClass,
        });
      }
    } catch {
      // D64 — wrapper-throw path (RESEND_API_KEY missing or SDK
      // unexpected throw). Drop the error object from the log;
      // record-failure helper writes badge + audit.
      console.error(
        "[invitations] resend email threw for",
        inv.refCode,
        "errorClass=config"
      );
      await recordInvitationSendFailure(supabase, {
        invitationId: inv.id,
        refCode: inv.refCode,
        kind: "resend",
        errorClass: "config",
      });
    }
  }

  await logAudit(supabase, {
    action: "invitation.resent",
    resource: inv.refCode,
    severity: "info",
    metadata: {
      invitationId: inv.id,
      mode: inProgress ? "resume" : "fresh",
      emailed,
    },
  });

  // D64 latent-bug fix: stamp invitations.sent_at on a successful resend so
  // the reminder cron's 7d / 14d anchor reflects the freshly rotated link.
  // Gated on `emailed` because the audit above fires whether the send
  // succeeded or not — but sent_at must only move forward on a real send.
  // Inline `new Date()` lands within microseconds of the audit row's
  // BEFORE-INSERT timestamp.
  //
  // D64 — also clear lastSendFailedAt on the ok resend ("clear on next ok
  // send" lifecycle). A row that previously failed but Sura just got
  // through manually should not keep its chip.
  //
  // NOT touched here: reminder1_sent_at / reminder_final_sent_at. A
  // resend overlaps with the auto-nudge cycle, and clearing those would
  // re-nudge a recipient Sura just reached out to manually. The opposite
  // read ("fresh link → fresh reminder cycle") is defensible too; locked
  // as Option A — resend preserves the auto-reminder state. Documented
  // in the STEP 10 RUNBOOK.
  if (emailed) {
    await updateInvitation(supabase, inv.id, {
      sentAt: new Date().toISOString(),
      lastSendFailedAt: null,
    });
  }

  // LOUD-FAILURE CONTRACT (D56) — why this surfaces louder than create:
  // on create, an email failure is benign (no link is dead; the URL is a
  // fallback). On resend the token_hash is ALREADY overwritten, so the OLD
  // link is dead; if the email also failed (emailed=false), the recipient
  // has a dead old link and no new one, and the ONLY copy of the working
  // new link is `tokenUrl` below. The UI MUST surface emailed=false
  // unmissably and show tokenUrl prominently so the owner hands it off
  // manually or retries. Do NOT downgrade this to a quiet warning, and do
  // NOT reorder (you can't email a token you haven't minted+rotated).
  return {
    ok: true,
    refCode: inv.refCode,
    tokenUrl,
    accessCode: accessCodePlaintext, // D66 — shown once on resend success
    emailed,
    mode: inProgress ? "resume" : "fresh",
  };
}

// ---------------------------------------------------------------------------
// revokeInvitationAction — owner-only terminal kill.
//
// Three operations performed together (all-or-none-by-effect):
//   1. Rotate token_hash to a freshly-minted hash whose PLAINTEXT IS
//      DISCARDED. The new hash has no plaintext that can produce it, so
//      validate_invitation_token (which hashes incoming plaintext + looks
//      up by hash) will never match. Old link permanently dead.
//   2. Set status='revoked' (terminal label for the admin UI).
//   3. Lock any in-progress (non-submitted) response — is_locked=TRUE
//      kicks any active session at next page load (lib/cookies.ts
//      getSession filters by is_locked; lib/actions/answers.ts saveAnswer
//      refuses on is_locked). Saved answers are RETAINED — is_locked is
//      a gate flag, not a CASCADE; the owner can still read everything
//      that was saved.
//
// Block-then-confirm gate: if a non-submitted response exists, refuses
// with error:"in_progress" UNLESS the caller passes confirmHardRevoke=
// true. The UI catches that, surfaces the honest confirmation ("their
// saved answers are retained but they cannot continue"), and re-calls
// with the flag. Default revoke never silently destroys a participant's
// in-flight work.
//
// Submitted-response block (unconditional, mirrors resend's
// already_submitted): an answered invitation is a research artifact;
// revoking it would be withdrawing data — a different operation (not
// built; tied to consent withdrawal).
//
// Terminal: revoke is one-way. Re-inviting = create a fresh invitation
// (owner picks a new ref_code; ref_code UNIQUE blocks reuse).
//
// RACE: validate_invitation_token is the SOLE creator of response rows
// (only INSERT INTO responses anywhere in the codebase or migrations,
// inside that SECURITY DEFINER function; RLS rejects all other inserts).
// Between the pre-rotation gate read (step 5) and the rotation (step 8)
// there is a sub-second window where the OLD token is still valid and
// a respondent could click /r/<old-token>, triggering validate to INSERT
// a fresh response. We close the window by re-reading the in-progress
// set AFTER rotation (step 9): validate's SELECT…FOR UPDATE on the
// invitation row serialises against step 8's UPDATE, so either the new
// response committed before rotation (visible to the post-rotation
// re-read) or validate sees the new hash and creates nothing. The lock
// step (step 10) operates on the post-rotation canonical set. The
// pre-rotation read remains useful for the UX gate (step 6 confirm
// dialog); a tiny residual edge — pre-read clean → respondent clicks
// → post-read finds one — silently locks that respondent without a
// confirm prompt, which is correct behaviour (they clicked AFTER the
// owner decided to revoke; they are already in the kill zone).
// ---------------------------------------------------------------------------

export type RevokeInvitationOptions = {
  /**
   * Set TRUE to override the in-progress-response block. The UI sets
   * this on the second call after surfacing the honest confirmation
   * ("their saved answers are retained but they cannot continue").
   * Default revoke (no flag) refuses with error:"in_progress" when any
   * non-submitted response exists for the invitation.
   */
  confirmHardRevoke?: boolean;
};

export type RevokeInvitationResult =
  | {
      ok: true;
      refCode: string;
      /** Final post-rotation reality: did we lock any response rows? */
      hadInProgressResponse: boolean;
      /** Final post-rotation reality: the IDs we set is_locked=TRUE on. */
      lockedResponseIds: string[];
    }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "already_submitted"
        | "already_revoked"
        | "in_progress"
        | "server";
    };

export async function revokeInvitationAction(
  invitationId: string,
  options: RevokeInvitationOptions = {}
): Promise<RevokeInvitationResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner —
  //    mirrors resend's pattern; RLS invitations_owner_all is the DB
  //    backstop).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "invitation.revoke.forbidden",
        resource: "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role, invitationId },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Load invitation (owner repo path; PII ciphertext available though
  //    revoke doesn't need it — we never email, never decrypt).
  const inv = await getInvitation(supabase, invitationId);
  if (!inv) return { ok: false, error: "not_found" };

  // 3. Terminal-state pre-check. Idempotent: re-revoking does nothing
  //    but report the existing state so a stale UI tab gets a clean
  //    signal instead of a silent re-rotation of an already-dead link.
  if (inv.status === "revoked") {
    return { ok: false, error: "already_revoked" };
  }

  // 4. Submitted-response block (unconditional). Same shape as resend's
  //    already_submitted: an answered invitation is a research artifact;
  //    revoking it would be withdrawing data, a separate operation tied
  //    to consent withdrawal.
  //    D63: filter to status='active' — a WITHDRAWN submitted response
  //    is no longer research data, so it doesn't block revoke. The
  //    withdraw flow (lib/actions/responses.ts) is the right tool for
  //    the post-submission data-removal half; revoke covers the
  //    pre-submission link-kill half. Together they cover all states.
  const { data: submittedRows, error: subErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
    .eq("status", "active")
    .not("submitted_at", "is", null)
    .limit(1);
  if (subErr) {
    console.error("[invitations] revoke responses(submitted) read failed", subErr);
    return { ok: false, error: "server" };
  }
  if ((submittedRows ?? []).length > 0) {
    return { ok: false, error: "already_submitted" };
  }

  // 5. PRE-ROTATION in-progress detection — feeds the gate decision in
  //    step 6 (the UI confirm dialog needs this). NOT the canonical set
  //    for the lock; that comes from step 9's post-rotation re-read.
  //    D63: filter to status='active' (in-progress withdrawn responses
  //    are impossible by the action's not_submitted gate, but defense
  //    in depth — the responses_withdrawn_state_consistent CHECK doesn't
  //    enforce status vs submitted_at, so a future bug could create the
  //    impossible row; this filter catches it).
  const { data: preRows, error: preErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
    .eq("status", "active")
    .is("submitted_at", null);
  if (preErr) {
    console.error("[invitations] revoke responses(in-progress, pre) read failed", preErr);
    return { ok: false, error: "server" };
  }
  const preInProgress = (preRows ?? []).length > 0;

  // 6. Block-then-confirm gate. Default revoke refuses if a response is
  //    in flight; the UI catches this, shows the honest confirmation,
  //    and re-calls with confirmHardRevoke=true. We do NOT audit the
  //    block — it's a UI gate, not a destructive action; auditing every
  //    "what's the state?" probe would flood the log. The actual
  //    revoke (step 11) is what gets audited, and it carries
  //    hadInProgressResponse so the audit reflects whether work was
  //    locked.
  if (preInProgress && !options.confirmHardRevoke) {
    return { ok: false, error: "in_progress" };
  }

  // 7. Mint a fresh token hash — PLAINTEXT IS DISCARDED (destructure
  //    picks `hash` only; `plaintext` falls out of scope untouched).
  //
  //    We intentionally do NOT call buildInvitationUrl — there is no
  //    link to issue. Side-benefit: a missing NEXT_PUBLIC_SITE_URL
  //    cannot block a revoke (a security-relevant op shouldn't depend
  //    on an env var only the reissue path needs).
  //
  //    D64 — DELIBERATE SKIP of token_plaintext_encrypted ENCRYPT step.
  //    Revoke is the terminal kill — the new hash has no recoverable
  //    plaintext (we just discarded it). Persisting a Vault-encrypted
  //    plaintext on a row whose token_hash no longer matches would be
  //    semantic garbage. Instead step 8 NULLs the column.
  const { hash } = mintInvitationToken();

  // 8. ROTATION + STATUS COMMIT — one UPDATE, atomic at the row level
  //    (Postgres applies multi-column updates atomically). Link dies
  //    AND terminal status set in a single write. AFTER this point,
  //    validate_invitation_token cannot create new responses for this
  //    invitation — the lookup hashes incoming plaintext and finds no
  //    match (the new hash has no known plaintext).
  //
  //    D64 — also NULL token_plaintext_encrypted. The previously-stored
  //    plaintext (if any, for D64+ rows) pointed at the OLD hash; that
  //    hash is now overwritten and the OLD plaintext is semantically
  //    dead. Nulling the column avoids orphan Vault ciphertext on a
  //    row whose hash has rotated away. (The reminder cron's status IN
  //    ('sent', 'opened') gate already excludes status='revoked' rows
  //    so the cron wouldn't read this column on a revoked row anyway;
  //    nulling is belt-and-suspenders.)
  try {
    // D66 — also NULL access_code_encrypted. The OLD code is semantically
    // dead the moment the row's terminal status lands (validate_invitation_
    // _code's candidate filter excludes NULL ciphertext rows, mirroring
    // the token_hash rotation kill primitive). Belt-and-suspenders: even
    // if a brute-force scan landed the code value just before this
    // commit, the next /enter attempt sees the NULL and returns empty.
    // access_code_used_at is preserved as-is — terminal forensic record.
    await updateInvitation(supabase, inv.id, {
      tokenHash: hash,
      tokenPlaintextEncrypted: null,
      accessCodeEncrypted: null, // D66
      status: "revoked",
    });
  } catch (err) {
    console.error("[invitations] revoke rotation/status update failed", err);
    return { ok: false, error: "server" };
  }

  // 9. POST-ROTATION re-read — canonical in-progress set. Closes the
  //    race window between step 5 and step 8: any validate call that
  //    snuck in with the old token between those points either
  //    committed its INSERT BEFORE step 8's UPDATE (visible here) or
  //    saw the new hash and inserted nothing. Either way this read is
  //    the final truth.
  //    D63: filter to status='active' (same defensive logic as step 5
  //    — keeps `lockedResponseIds` clean of any impossible withdrawn
  //    in-progress row).
  const { data: finalRows, error: finalErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
    .eq("status", "active")
    .is("submitted_at", null);
  if (finalErr) {
    console.error("[invitations] revoke responses(in-progress, post) read failed", finalErr);
    return { ok: false, error: "server" };
  }
  const lockedResponseIds = (finalRows ?? []).map((r) => r.id);
  const hadInProgressResponse = lockedResponseIds.length > 0;

  // 10. Lock the canonical set. Kicks active sessions at next page
  //     load (getSession filters by is_locked); saveAnswer also
  //     refuses on is_locked. Idempotent: is_locked=TRUE on an
  //     already-locked row is a no-op, so a retry after a transient
  //     failure is safe.
  //
  //     ORDERING: rotation+status (step 8) FIRST, lock (this step)
  //     SECOND. If the lock fails, the link is already dead and the
  //     status is terminal — soft-failure mode where the respondent
  //     can finish their current draft via the existing cookie but
  //     cannot re-enter via the link. Surfaced as server error so the
  //     owner can re-try.
  if (hadInProgressResponse) {
    const { error: lockErr } = await supabase
      .from("responses")
      .update({ is_locked: true })
      .in("id", lockedResponseIds);
    if (lockErr) {
      console.error("[invitations] revoke is_locked update failed", lockErr);
      return { ok: false, error: "server" };
    }
  }

  // 11. Audit — severity=warn. Terminal cut-off is security-relevant;
  //     the actor identity is filled by the trigger in
  //     20260519170003_functions.sql (tg_audit_log_fill_actor). No PII
  //     in metadata — invitationId/refCode/response IDs only.
  //     hadInProgressResponse reflects the POST-rotation reality (what
  //     we actually locked), not the pre-rotation gate read.
  await logAudit(supabase, {
    action: "invitation.revoke",
    resource: inv.refCode,
    severity: "warn",
    metadata: {
      invitationId: inv.id,
      hadInProgressResponse,
      lockedResponseIds,
    },
  });

  return {
    ok: true,
    refCode: inv.refCode,
    hadInProgressResponse,
    lockedResponseIds,
  };
}
