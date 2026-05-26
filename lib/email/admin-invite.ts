// lib/email/admin-invite.ts
//
// Admin (supervisor) invitation email via Resend. Mirrors the shape of
// lib/email/invitation.ts (verified sender, app-controlled HTML, never logs
// recipient address or token URL) but for the read-only supervisor enrollment
// flow instead of the respondent flow.
//
// EN-only by design: Sura's two supervisors (Dr Obeidat at JUST, Dr Tice) are
// English-speaking academics, and the read-only admin console is EN-only. If
// a future supervisor needs Arabic, add it the same way invitation.ts does
// (parallel AR object + dir flip).
//
// Magic link format matches the RUNBOOK template (`type=email`) so all admin
// sign-in links share one diagnosis path. The hashed_token comes from the
// caller's prior `supabase.auth.admin.generateLink({type:'magiclink', email})`
// call; we construct the /admin/callback URL ourselves rather than using
// Supabase's action_link (which is /auth/v1/verify… and not what the callback
// route expects).
//
// NEVER logs the recipient address or the magic link.

import { Resend } from "resend";

const FROM = "Yarmouk Study <noreply@karasneh-research.org>"; // verified production sender (karasneh-research.org)
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

export type SendAdminInviteEmailInput = {
  to: string;
  /** Recipient's display name — appears in the email greeting. */
  name: string;
  /** The fully-built /admin/callback?token_hash=…&type=email URL. */
  signInUrl: string;
};

/**
 * Send one admin-invite email. Returns { ok } — the caller decides how a
 * failure surfaces. Unlike the respondent invitation, an admin-invite email
 * failure is RECOVERABLE: the admins row already exists and Sura can
 * regenerate a new magic link (Supabase's standard login flow works the
 * moment the auth.users row exists). The caller surfaces this clearly so a
 * one-off SMTP blip doesn't look like a created-then-lost admin.
 */
export async function sendAdminInviteEmail(
  input: SendAdminInviteEmailInput
): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — cannot send admin invite email."
    );
  }

  const subject = "You've been added as a supervisor on the Yarmouk Study";

  const intro = `Sura Karasneh has added you as a read-only supervisor on the Yarmouk Study research platform. You'll be able to review responses, themes, and analytics — but not edit questionnaires or send invitations.`;
  const cta = "Sign in";
  const fine = `This link signs you in. It expires shortly — open it on a device you'll use for the admin console. If you weren't expecting this, ignore it; no account is active until you click.`;
  const contactLine = `Questions? Reply to this email or contact Sura at sjkarasneh24@eng.just.edu.jo.`;

  const text = [
    `Hello ${input.name},`,
    "",
    intro,
    "",
    `${cta}:`,
    input.signInUrl,
    "",
    fine,
    "",
    contactLine,
  ].join("\n");

  const html = `<div dir="ltr" style="margin:0 auto;max-width:520px;background:#ffffff;border:0.5px solid #e6e4de;border-radius:12px;padding:32px 34px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#33322f">
    <p style="margin:0 0 18px;font-size:15px;color:#33322f">Hello ${escapeHtml(input.name)},</p>
    <p style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#33322f">${intro}</p>
    <p style="margin:0 0 28px">
      <a href="${input.signInUrl}" style="display:inline-block;background:#185FA5;color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;padding:13px 30px;border-radius:8px">${cta}</a>
    </p>
    <div style="border-top:0.5px solid #ececea;padding-top:18px">
      <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8982">${fine}</p>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#5f5e59">${contactLine.replace(
        "sjkarasneh24@eng.just.edu.jo",
        `<a href="mailto:sjkarasneh24@eng.just.edu.jo" style="color:#185FA5;text-decoration:none">sjkarasneh24@eng.just.edu.jo</a>`
      )}</p>
    </div>
  </div>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      replyTo: REPLY_TO,
      subject,
      text,
      html,
    });
    if (error) {
      // Never log the address.
      console.error("[email] admin-invite send failed —", error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      "[email] admin-invite send threw —",
      (err as Error).message
    );
    return { ok: false };
  }
}

// Minimal HTML escape for the name field (the only user-supplied string in
// the HTML). The intro/fine/contactLine are static and the signInUrl is
// constructed from a Supabase-generated hashed_token + our own base — no
// untrusted text reaches HTML there.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
