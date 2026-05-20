"use server";

// lib/actions/invitations.ts
//
// createInvitationAction — owner-only invitation minting (3b-i).
// Flow: owner gate → validate → mint token (D44) → encrypt PII → insert
// → audit (D54) → return the one-time token URL (D53).
//
// response/PII/token handling: the plaintext token is returned ONCE and
// never stored/logged/placed in a URL. Name + email are encrypted in the
// DB via encrypt_pii (granted to authenticated; the owner's server client
// calls it — no service-role needed). Only the SHA-256 token_hash and the
// ciphertext PII are persisted.

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { createInvitation } from "@/lib/repos/invitations";
import { mintInvitationToken } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";

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
};

export type CreateInvitationResult =
  | { ok: true; refCode: string; tokenUrl: string }
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

  // 6. One-time token URL (D53) — shown once; never stored/logged/in a URL.
  return {
    ok: true,
    refCode: v.refCode,
    tokenUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/r/${plaintext}`,
  };
}
