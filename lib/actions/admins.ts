"use server";

// lib/actions/admins.ts
//
// Owner-only admin invitation action (self-service Stage 1+2 unblock).
//
// inviteAdminAction provisions a READ-ONLY supervisor account end-to-end
// from a single owner click:
//   1. Owner gate (+ forbidden audit for a non-owner session).
//   2. Validate (zod): name 1+, email regex + lowercase normalized.
//   3. Pre-flight on admins table — already admin? → email_already_admin.
//   4. SERVICE-ROLE → auth.admin.createUser({email, email_confirm:true}).
//      A unique-violation in auth.users → email_already_auth_user (handles
//      the rare dashboard-pre-created identity collision).
//   5. SERVICE-ROLE → auth.admin.generateLink({type:'magiclink', email}) →
//      hashed_token. We construct /admin/callback?token_hash=…&type=email
//      ourselves (matches the RUNBOOK template, unifying admin sign-in
//      paths). NEVER use the returned action_link directly — it points at
//      /auth/v1/verify and bypasses our callback route.
//   6. AUTHENTICATED (owner) client → INSERT admins(role='readonly').
//      Goes through RLS qv_owner-equivalent admins_owner_all + the Inv1
//      trigger; the hard-coded 'readonly' value satisfies both.
//   7. ORPHAN-CLEANUP SAGA: if step 6 fails, the auth.users row from step 4
//      is orphaned (no application admin pointing at it). We immediately
//      call auth.admin.deleteUser to undo. If THAT also fails, the email
//      cannot be re-invited (createUser will collide on retry) and the
//      mismatch is invisible from any normal admin surface. So: log loudly
//      via console.error AND fire a warn-severity audit row carrying the
//      orphan email — discoverable from /admin/security with one click.
//   8. Send the branded magic-link email via Resend. Failure is benign
//      (admins row exists; standard login flow works the moment Supabase
//      delivers a magic link for the now-existing auth.users), surfaced as
//      ok:true with emailed:false.
//   9. logAudit (admin.invite, success).
//
// What this action DELIBERATELY does NOT do:
//   - accept any `role` field from input. The input type has no role
//     property. The hard-code 'readonly' goes through the repo's narrowed
//     parameter type ('readonly' only — TypeScript rejects 'owner') AND
//     the DB trigger (Inv1) rejects role='owner' from this JWT context.
//     Defense in depth: type, hard-code, trigger.
//   - mint owners. Same chain blocks the path at three layers.
//   - service-role for the admins INSERT. The admins write uses the
//     AUTHENTICATED owner client so RLS + Inv1 fire on it. Service-role is
//     used ONLY for the two auth.admin.* calls that intrinsically require
//     it (managing auth.users, which lives outside our schema).

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentAdmin } from "@/lib/auth";
import { getAdminByEmail, insertAdmin } from "@/lib/repos/admins";
import { sendAdminInviteEmail } from "@/lib/email/admin-invite";
import { logAudit } from "@/lib/audit";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(EMAIL_RE, "A valid email is required"),
});

// Loose form shape; zod narrows. NO role field — owner-creation is
// structurally impossible from this action.
export type InviteAdminInput = {
  name: string;
  email: string;
};

export type InviteAdminResult =
  | { ok: true; emailed: boolean }
  | {
      ok: false;
      error:
        | "forbidden"
        | "validation"
        | "email_already_admin"
        | "email_already_auth_user"
        | "server";
      issues?: string[];
    };

export async function inviteAdminAction(
  input: InviteAdminInput
): Promise<InviteAdminResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate.
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "admin.invite.forbidden",
        resource: "",
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

  // 3. Build the sign-in URL base BEFORE any privileged call. A missing
  //    NEXT_PUBLIC_SITE_URL fails here rather than after creating an
  //    auth.users row we can't link to.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    console.error("[admins] NEXT_PUBLIC_SITE_URL is not set");
    return { ok: false, error: "server" };
  }

  // 4. Pre-flight: already an admin? (Cheap before any privileged call.)
  try {
    const existing = await getAdminByEmail(supabase, v.email);
    if (existing) {
      return { ok: false, error: "email_already_admin" };
    }
  } catch (err) {
    console.error("[admins] pre-flight getAdminByEmail failed", err);
    return { ok: false, error: "server" };
  }

  // 5. SERVICE-ROLE: pre-create the auth.users identity. email_confirm:true
  //    bypasses Supabase's confirmation-email step (we send our own branded
  //    link in step 8).
  const adminClient = createSupabaseAdminClient();
  const { data: createdUser, error: createErr } =
    await adminClient.auth.admin.createUser({
      email: v.email,
      email_confirm: true,
    });

  if (createErr || !createdUser?.user) {
    // The supabase-js admin API doesn't expose Postgres SQLSTATEs cleanly
    // here; surface a unique-violation as a typed error by name/code match.
    // (createUser returns AuthApiError with status 422 + "User already
    // registered" when the email already exists in auth.users.)
    const msg = createErr?.message?.toLowerCase() ?? "";
    if (
      createErr?.status === 422 ||
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists")
    ) {
      return { ok: false, error: "email_already_auth_user" };
    }
    console.error("[admins] auth.admin.createUser failed", createErr);
    return { ok: false, error: "server" };
  }

  const newUserId = createdUser.user.id;

  // 6. AUTHENTICATED (owner) client: INSERT admins row. RLS + Inv1 fire.
  //    role HARD-CODED 'readonly' — TypeScript rejects 'owner' via the
  //    repo's narrowed parameter type; Inv1 rejects 'owner' at the DB.
  let newAdmin;
  try {
    newAdmin = await insertAdmin(supabase, {
      email: v.email,
      name: v.name,
      role: "readonly",
    });
  } catch (err) {
    // ── ORPHAN-CLEANUP SAGA ────────────────────────────────────────────
    // The auth.users row exists; the admins row doesn't. If we leave it,
    // a retry of inviteAdminAction will hit email_already_auth_user
    // (createUser collision) — invisible from any normal admin surface,
    // hard to diagnose. Two-tier recovery:
    //   (a) Try deleteUser. If it succeeds, the orphan is gone; the
    //       outer return surfaces a clean "server" error and the owner
    //       can retry.
    //   (b) If deleteUser does NOT succeed — either it returns {error}
    //       (typical for auth-API failures) or it throws unexpectedly
    //       (network / transport / unexpected) — the orphan persists.
    //       Log it loudly AND fire a warn-severity audit row carrying
    //       the email so the owner can spot it in /admin/security and
    //       resolve manually.
    console.error(
      "[admins] admins INSERT failed after auth.users creation — saga undo",
      err
    );

    // The deleteUser call itself is wrapped — even an unexpected throw
    // (the supabase-js admin API normally uses the {data,error} pattern,
    // but a network/transport-layer error could escape as a rejection)
    // must still produce the orphan audit row. Without this wrap, a
    // thrown deleteUser would propagate out of the saga and the orphan
    // would persist with no audit breadcrumb.
    let deleteOk = false;
    let deleteErrMessage: string | null = null;
    try {
      const { error: delErr } = await adminClient.auth.admin.deleteUser(
        newUserId
      );
      if (delErr) {
        deleteErrMessage = delErr.message;
      } else {
        deleteOk = true;
      }
    } catch (deleteThrew) {
      deleteErrMessage =
        (deleteThrew as Error).message ?? "deleteUser threw unexpectedly";
    }

    if (!deleteOk) {
      console.error(
        "[admins] ORPHAN — auth.users row was created but admins INSERT failed AND deleteUser did not succeed.",
        "auth.users id:",
        newUserId,
        "email:",
        v.email,
        "deleteUser result:",
        deleteErrMessage
      );
      // Best-effort audit; cannot throw (we're already in a failure
      // recovery path). Wrap so an audit hiccup doesn't mask the orphan.
      try {
        await logAudit(supabase, {
          action: "admin.invite.orphan",
          resource: v.email,
          severity: "warn",
          metadata: {
            authUserId: newUserId,
            insertError: (err as Error).message,
            deleteError: deleteErrMessage,
          },
        });
      } catch (auditErr) {
        console.error(
          "[admins] orphan-audit write also failed",
          auditErr
        );
      }
    }

    return { ok: false, error: "server" };
  }

  // 7. SERVICE-ROLE: generate the magic-link hashed_token for this user.
  //    Done AFTER the admins row exists so any failure here leaves a
  //    consistent state (auth.users exists, admins row exists, just no
  //    email sent yet — the owner can regenerate via standard login flow
  //    or via a future "resend magic link" button).
  const { data: linkData, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: v.email,
    });

  let signInUrl: string | null = null;
  if (!linkErr && linkData?.properties?.hashed_token) {
    signInUrl = `${siteUrl.replace(
      /\/$/,
      ""
    )}/admin/callback?token_hash=${linkData.properties.hashed_token}&type=email`;
  } else {
    console.error("[admins] generateLink failed", linkErr);
  }

  // 8. Send the branded email (if we have a link). Failure is benign —
  //    standard login flow works the moment the auth.users row exists.
  let emailed = false;
  if (signInUrl) {
    try {
      const sent = await sendAdminInviteEmail({
        to: v.email,
        name: v.name,
        signInUrl,
      });
      emailed = sent.ok;
    } catch (err) {
      console.error("[admins] sendAdminInviteEmail threw", err);
    }
  }

  // 9. Audit success. NO email in metadata (admin emails are operational
  //    identifiers but we keep the audit-log surface minimal — the
  //    adminId is enough to look up who was invited from the team page).
  await logAudit(supabase, {
    action: "admin.invite",
    resource: v.email, // surfaced in the audit viewer's resource column
    severity: "info",
    metadata: {
      adminId: newAdmin.id,
      role: "readonly",
      emailed,
    },
  });

  return { ok: true, emailed };
}
