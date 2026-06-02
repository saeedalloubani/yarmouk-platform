// lib/email/invitation.ts
//
// D22 — thin wrapper around the template renderer (lib/email/templates/
// render.ts). The pre-D22 hard-coded EN/AR copy objects have been
// extracted into lib/email/templates/defaults.ts; this module is now:
//
//   1. Load the customization row from email_templates (if any).
//   2. Overlay it on the defaults to get a complete ResolvedTemplate.
//   3. Call the renderer.
//   4. Hand the result to Resend.
//
// The exported function shape — sendInvitationEmail(input) → { ok } —
// is UNCHANGED. Existing callers (lib/actions/invitations.ts:210 and
// :354) are not touched.
//
// LOAD-BEARING PROPERTIES preserved from the pre-D22 version:
//   - NEVER logs the recipient address or the token URL.
//   - throws ONLY on missing RESEND_API_KEY (config).
//   - returns { ok: false, errorClass } on Resend errors so the caller
//     can decide surfacing (benign on create, loud on resend after
//     token rotation). The errorClass buckets the failure for audit
//     metadata + the last_send_failed_at badge WITHOUT carrying the
//     raw Resend error.message (which can echo recipient addresses).
//
// D64 — return type widened from `{ ok: boolean }` to EmailSendResult
// (lib/email/types). The `kind`-aware caller injects 'invitation' or
// 'resend' into its own audit metadata. console.error lines now log
// `refCode + errorClass=…` instead of the raw error object so even our
// ephemeral server logs avoid PII leakage of recipient addresses.
//
// TEMPLATE LOAD is via service-role admin client. The email_templates
// row holds non-PII configuration; service-role bypasses RLS (fine since
// this code is invoked from the respondent submit + owner-action paths
// where we already use service-role for non-PII config reads). A read
// failure DOES NOT abort the send — it falls through to defaults, so a
// transient DB hiccup never deprives an invitee of their invitation.

import { Resend } from "resend";
import type { Lang } from "@/lib/i18n";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
} from "@/lib/email/templates/render";
import type { EmailSendResult } from "@/lib/email/types";

const FROM = "Yarmouk Study <noreply@karasneh-research.org>"; // verified production sender (karasneh-research.org)
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

export type SendInvitationEmailInput = {
  to: string;
  lang: Lang;
  refCode: string;
  tokenUrl: string;
  expiresAt: string; // ISO
  /** D66 — 6-digit participant access code (URL-prefetch fallback).
   *  Interpolated into the {access_code} placeholder of the invitation's
   *  access_code section (REQUIRED placeholder; see TEMPLATE_SPECS). The
   *  caller must always supply a non-empty value for participant invites;
   *  the renderer's validator rejects send-with-empty. */
  accessCode: string;
};

/**
 * Send one invitation email. Returns EmailSendResult — the caller
 * decides how a failure surfaces (benign on create; LOUD on resend,
 * where the old link is already dead). On failure, `errorClass` is set
 * so the caller can audit + chip without carrying the raw Resend
 * message. Throws only on missing RESEND_API_KEY (config); the caller's
 * catch buckets it to errorClass='config'. Never logs the recipient
 * address or the token URL.
 */
export async function sendInvitationEmail(
  input: SendInvitationEmailInput
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — cannot send invitation email.");
  }

  // 1. Load template customization (if any). A failure here logs but
  //    DOES NOT abort — defaults still produce a working email.
  let storedSubject: string | null = null;
  let storedSections: Partial<Record<string, string>> | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const row = await getTemplate(admin, "invitation");
    if (row) {
      if (input.lang === "ar") {
        storedSubject = row.subjectAr;
        storedSections = row.sectionsAr ?? null;
      } else {
        storedSubject = row.subjectEn;
        storedSections = row.sectionsEn;
      }
    }
  } catch {
    // D64 — log the bucket, not the raw message (which could echo PII).
    // Template-load failure is non-aborting; defaults still produce a
    // working email so this isn't a returned failure either.
    console.error(
      "[email] invitation template load failed for",
      input.refCode,
      "errorClass=config (non-aborting; falling back to defaults)"
    );
  }

  // 2. Merge with defaults to a complete render-ready template.
  const defaults = getDefaults("invitation");
  const localeDefaults = input.lang === "ar" ? defaults.ar : defaults.en;
  if (!localeDefaults) {
    // Should never happen (invitation is bilingual), but a defensive
    // log + 'config' failure beats a thrown undefined-dereference.
    console.error(
      "[email] invitation defaults missing for",
      input.refCode,
      "lang",
      input.lang,
      "errorClass=config"
    );
    return { ok: false, errorClass: "config" };
  }
  const template = resolveTemplate({
    templateId: "invitation",
    lang: input.lang,
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: storedSubject,
    overlaySections: storedSections ?? null,
  });

  // 3. Format the expiry date per locale (same as the pre-D22 behavior).
  const isAr = input.lang === "ar";
  const expiry_date = new Date(input.expiresAt).toLocaleDateString(
    isAr ? "ar-JO" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  // 4. Render. button_href is system-owned — it's the real token URL the
  //    caller built via lib/tokens.ts. The renderer wraps it in the
  //    fixed-shell button; the editor surface never sees it.
  const { subject, text, html } = renderEmailTemplate({
    template,
    values: {
      expiry_date,
      ref_code: input.refCode,
      access_code: input.accessCode, // D66 — 6-digit fallback
      button_href: input.tokenUrl,
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
      // D64 — log the bucket, not error.message. Resend's strings can
      // echo recipient addresses ("Failed to send to user@host"); even
      // ephemeral server logs avoid PII.
      console.error(
        "[email] invitation send failed for",
        input.refCode,
        "errorClass=send"
      );
      return { ok: false, errorClass: "send" };
    }
    return { ok: true };
  } catch {
    console.error(
      "[email] invitation send threw for",
      input.refCode,
      "errorClass=send"
    );
    return { ok: false, errorClass: "send" };
  }
}
