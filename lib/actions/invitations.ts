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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  createInvitation,
  getInvitation,
  updateInvitation,
} from "@/lib/repos/invitations";
import { mintInvitationToken, buildInvitationUrl } from "@/lib/tokens";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { logAudit } from "@/lib/audit";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().regex(EMAIL_RE, "A valid email is required"),
  category: z.enum(["officials", "researchers", "donors", "ngos"]),
  nationality: z.enum(["jordanian", "syrian", "not_applicable"]),
  preferredLanguage: z.enum(["en", "ar"]),
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
  refCode: string;
  questionnaireVersionId: string;
  expiresAt: string;
  maxUses: number;
  sendEmail: boolean;
};

export type CreateInvitationResult =
  | { ok: true; refCode: string; tokenUrl: string; emailed: boolean }
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

  // 3. Mint (D44). Plaintext exists only here + in the return value.
  const { plaintext, hash } = mintInvitationToken();

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
  const { data: nameEnc, error: e1 } = await supabase.rpc("encrypt_pii", {
    p_plaintext: v.name,
  });
  const { data: emailEnc, error: e2 } = await supabase.rpc("encrypt_pii", {
    p_plaintext: v.email.toLowerCase(),
  });
  if (e1 || e2 || !nameEnc || !emailEnc) {
    console.error("[invitations] encrypt_pii failed", e1 ?? e2);
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
      refCode: v.refCode,
      recipientNameEncrypted: nameEnc,
      recipientEmailEncrypted: emailEnc,
      category: v.category,
      nationality: v.nationality,
      preferredLanguage: v.preferredLanguage,
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
      });
      emailed = sent.ok;
      if (sent.ok) {
        await logAudit(supabase, {
          action: "invitation.email_sent",
          resource: v.refCode,
          severity: "info",
          metadata: { invitationId: createdId },
        });
      }
    } catch (err) {
      console.error("[invitations] send-at-create email failed", err);
    }
  }

  // 7. One-time token URL (D53) — shown once; never stored/logged/in a URL.
  return { ok: true, refCode: v.refCode, tokenUrl, emailed };
}

// ---------------------------------------------------------------------------
// resendInvitationAction — owner-only token rotation + re-send (3b-ii, D56)
// ---------------------------------------------------------------------------

export type ResendInvitationResult =
  | {
      ok: true;
      refCode: string;
      tokenUrl: string;
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
  const { data: submittedRows, error: subErr } = await supabase
    .from("responses")
    .select("id")
    .eq("invitation_id", inv.id)
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
    .is("submitted_at", null)
    .limit(1);
  if (ipErr) {
    console.error("[invitations] resend responses(in-progress) read failed", ipErr);
    return { ok: false, error: "server" };
  }
  const inProgress = (inProgressRows ?? []).length > 0;

  // 4. Mint + guard the new link BEFORE the rotation, so a missing
  //    NEXT_PUBLIC_SITE_URL leaves the OLD link alive.
  const { plaintext, hash } = mintInvitationToken();
  let tokenUrl: string;
  try {
    tokenUrl = buildInvitationUrl(plaintext);
  } catch (err) {
    console.error("[invitations] buildInvitationUrl failed (resend)", err);
    return { ok: false, error: "server" };
  }

  const newExpiry = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  // 5. ── ROTATION COMMITS HERE ── the old link dies the instant token_hash
  //    is overwritten. Resume re-send keeps use_count/status/opened_at so
  //    the new link resumes the in-progress response via validate's
  //    resumption path; fresh re-send resets to a clean, claimable state.
  try {
    if (inProgress) {
      await updateInvitation(supabase, inv.id, {
        tokenHash: hash,
        expiresAt: newExpiry,
      });
    } else {
      await updateInvitation(supabase, inv.id, {
        tokenHash: hash,
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
  } else {
    const sent = await sendInvitationEmail({
      to: email,
      lang: inv.preferredLanguage,
      refCode: inv.refCode,
      tokenUrl,
      expiresAt: newExpiry,
    });
    emailed = sent.ok;
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
    emailed,
    mode: inProgress ? "resume" : "fresh",
  };
}
