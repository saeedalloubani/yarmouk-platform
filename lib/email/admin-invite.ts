// lib/email/admin-invite.ts
//
// D22 Stage 2 — thin wrapper around the template renderer (lib/email/
// templates/render.ts). The pre-Stage-2 hard-coded EN copy has been
// extracted into lib/email/templates/defaults.ts (ADMIN_INVITE); this
// module is now the same shape as the post-D22 invitation.ts wrapper:
//
//   1. Load the customization row from email_templates (if any).
//   2. Overlay it on the defaults to get a complete ResolvedTemplate.
//   3. Call the renderer.
//   4. Hand the result to Resend.
//
// EN-ONLY by design (admin-invite spec.bilingual=false). Sura's two
// supervisors (Dr Obeidat at JUST, Dr Tice) are English-speaking
// academics and the read-only admin console is EN-only. The editor
// hides the AR column for this template.
//
// The exported function shape — sendAdminInviteEmail(input) → { ok } —
// is UNCHANGED. The single caller (lib/actions/admins.ts:279) is not
// touched.
//
// LOAD-BEARING PROPERTIES preserved from the pre-Stage-2 version:
//   - NEVER logs the recipient address or the magic link URL.
//   - Admin-invite email failure is RECOVERABLE: the admins row already
//     exists and Sura can regenerate a new magic link (Supabase's
//     standard login flow works the moment the auth.users row exists).
//   - Returns { ok: false, errorClass } on Resend errors so the caller
//     can surface a "created but not emailed" warning to Sura AND log a
//     'admin.invite.email_failed' audit row with the errorClass bucket.
//
// D64 — return type widened from `{ ok: boolean }` to EmailSendResult.
// console.error lines now log errorClass instead of the raw error
// message (Resend's strings can echo recipient addresses). NO
// invitations.last_send_failed_at write: admin-invite is admins-row-
// bound, not invitation-row-bound; the audit row is the forensic
// surface.
//
// CHROME UNIFICATION vs the pre-Stage-2 hardcoded shell:
//   - greeting/intro font-size 15px → 16px (+1px)
//   - greeting paragraph margin-bottom 18px → 16px (-2px gap)
//   - all other paragraphs + button + divider: byte-identical
//   - plain-text body: byte-identical
//   Deltas accepted as brand-unification (D22 Stage 2 close-out note).
//
// TEMPLATE LOAD is via service-role admin client — the email_templates
// row is non-PII configuration; service-role bypasses RLS, fine for
// this code path. A read failure DOES NOT abort the send — it falls
// through to defaults, so a transient DB hiccup never deprives a new
// supervisor of their invitation.

import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
} from "@/lib/email/templates/render";
import type { SectionKey } from "@/lib/email/templates/types";
import type { EmailSendResult } from "@/lib/email/types";

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
 * failure surfaces. Unlike the respondent invitation, an admin-invite
 * email failure is RECOVERABLE: the admins row already exists and Sura
 * can regenerate a new magic link (Supabase's standard login flow works
 * the moment the auth.users row exists). The caller surfaces this
 * clearly so a one-off SMTP blip doesn't look like a created-then-lost
 * admin.
 */
export async function sendAdminInviteEmail(
  input: SendAdminInviteEmailInput
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — cannot send admin invite email."
    );
  }

  // 1. Load template customization (if any). A failure here logs but
  //    DOES NOT abort — defaults still produce a working email.
  let storedSubject: string | null = null;
  let storedSections: Partial<Record<SectionKey, string>> | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const row = await getTemplate(admin, "admin-invite");
    if (row) {
      storedSubject = row.subjectEn;
      storedSections = row.sectionsEn;
    }
  } catch {
    // D64 — bucket only; template-load failure is non-aborting.
    console.error(
      "[email] admin-invite template load failed",
      "errorClass=config (non-aborting; falling back to defaults)"
    );
  }

  // 2. Merge with defaults to a complete render-ready template.
  const defaults = getDefaults("admin-invite");
  const localeDefaults = defaults.en; // EN-only template
  const template = resolveTemplate({
    templateId: "admin-invite",
    lang: "en",
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: storedSubject,
    overlaySections: storedSections ?? null,
  });

  // 3. Render. button_href is system-owned — the Supabase-generated
  //    /admin/callback URL the caller built. The renderer wraps it in
  //    the fixed-shell button; the editor surface never sees it.
  //    {name} interpolation is supplied via values.name.
  const { subject, text, html } = renderEmailTemplate({
    template,
    values: {
      name: input.name,
      expiry_date: "",   // unused — admin-invite has no expiry placeholder
      ref_code: "",      // unused
      access_code: "",   // unused — admin-invite is admins-row-bound (D66)
      button_href: input.signInUrl,
    },
  });

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
      // D64 — bucket only; Resend's error.message can echo the address.
      console.error("[email] admin-invite send failed", "errorClass=send");
      return { ok: false, errorClass: "send" };
    }
    return { ok: true };
  } catch {
    console.error("[email] admin-invite send threw", "errorClass=send");
    return { ok: false, errorClass: "send" };
  }
}
