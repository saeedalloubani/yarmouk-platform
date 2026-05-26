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
//   - returns { ok: false } on Resend errors so the caller can decide
//     surfacing (benign on create, loud on resend after token rotation).
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
  renderInvitationEmail,
  resolveTemplate,
} from "@/lib/email/templates/render";

const FROM = "Yarmouk Study <noreply@karasneh-research.org>"; // verified production sender (karasneh-research.org)
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

export type SendInvitationEmailInput = {
  to: string;
  lang: Lang;
  refCode: string;
  tokenUrl: string;
  expiresAt: string; // ISO
};

/**
 * Send one invitation email. Returns { ok } — the caller decides how a
 * failure surfaces (benign on create; LOUD on resend, where the old link
 * is already dead). Throws only on missing RESEND_API_KEY (config).
 * Never logs the recipient address or the token URL.
 */
export async function sendInvitationEmail(
  input: SendInvitationEmailInput
): Promise<{ ok: boolean }> {
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
  } catch (err) {
    console.error(
      "[email] invitation template load failed for",
      input.refCode,
      "— falling back to defaults",
      (err as Error).message
    );
  }

  // 2. Merge with defaults to a complete render-ready template.
  const defaults = getDefaults("invitation");
  const localeDefaults = input.lang === "ar" ? defaults.ar : defaults.en;
  if (!localeDefaults) {
    // Should never happen (invitation is bilingual), but a defensive log
    // beats a thrown undefined-dereference.
    console.error("[email] invitation defaults missing for lang", input.lang);
    return { ok: false };
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
  const { subject, text, html } = renderInvitationEmail({
    template,
    values: {
      expiry_date,
      ref_code: input.refCode,
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
      console.error(
        "[email] invitation send failed for",
        input.refCode,
        "—",
        error.message
      );
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      "[email] invitation send threw for",
      input.refCode,
      "—",
      (err as Error).message
    );
    return { ok: false };
  }
}
