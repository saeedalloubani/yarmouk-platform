// lib/email/submission.ts
//
// D22 Stage 2 — thin wrapper around the template renderer (lib/email/
// templates/render.ts). The pre-Stage-2 hard-coded EN copy has been
// extracted into lib/email/templates/defaults.ts (SUBMISSION); this
// module is now the same shape as the post-D22 invitation.ts wrapper:
//
//   1. Load the customization row from email_templates (if any).
//   2. Overlay it on the defaults to get a complete ResolvedTemplate.
//   3. Call the renderer.
//   4. Hand the result to Resend.
//
// EN-ONLY by design (submission spec.bilingual=false). The admin
// console is English-only. IDENTITY-FREE — references the response
// by ref_code only, NEVER the respondent's name, mirroring the
// dashboard's discipline.
//
// The exported function shape — sendSubmissionEmail(input) → { ok } —
// is UNCHANGED. The single caller (lib/notifications.ts:97) is not
// touched. The `href` field remains typed `string | undefined` to
// match the caller's emailHref shape (which falls back to undefined
// when NEXT_PUBLIC_SITE_URL is unset, e.g. in dev). When undefined,
// we cannot supply a system-owned button_href, so the wrapper logs
// the misconfig and returns { ok: false } rather than rendering a
// broken button. In prod (D22 Stage 2 decision B option (i)) the
// caller always supplies a real URL, so the structural button
// guarantee holds on the path that matters.
//
// LOAD-BEARING PROPERTIES preserved:
//   - NEVER logs the recipient address (only ref_code + error message).
//   - Throws ONLY on missing RESEND_API_KEY (config).
//   - Returns { ok: false } on Resend errors so notifications.ts logs a
//     non-fatal event and never lets it affect the respondent's submit.
//
// CHROME UNIFICATION vs the pre-Stage-2 hardcoded shell:
//   - bare 520px <div> + browser-default paragraphs  →  white card with
//     border + padding + the same blue inline-block button as the other
//     two templates. Owner-only recipient (Sura); strict visual
//     improvement; structural button guarantee.
//   - plain-text body changes from "${lead}\n\n${cta} ${href}" to
//     "${lead}\n\n${cta}:\n${href}" — matches invitation/admin-invite
//     pattern.
//
// TEMPLATE LOAD is via service-role admin client — same convention as
// invitation.ts / admin-invite.ts. A read failure DOES NOT abort the
// send; it falls through to defaults.

import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
} from "@/lib/email/templates/render";
import type { SectionKey } from "@/lib/email/templates/types";

const FROM = "Yarmouk Study <noreply@karasneh-research.org>"; // verified production sender (karasneh-research.org)
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

export type SendSubmissionEmailInput = {
  to: string; // an active owner's plaintext admins.email
  refCode: string; // identity-free response key — NEVER the respondent's name
  /** Absolute link to the response detail in the admin console.
   *  Becomes the system-owned button href. Optional ONLY because
   *  the caller (notifications.ts) builds it from
   *  NEXT_PUBLIC_SITE_URL which can be unset in dev — in prod it's
   *  always set, so the structural button guarantee holds. When
   *  undefined we abort with { ok: false } rather than render a
   *  broken button. */
  href?: string;
};

/**
 * Send one submission-notification email to an owner. Returns { ok } —
 * the caller logs a false/threw result distinctly and never lets it
 * affect the respondent's submit. Throws ONLY on missing
 * RESEND_API_KEY (config). Never logs the recipient address.
 */
export async function sendSubmissionEmail(
  input: SendSubmissionEmailInput
): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — cannot send submission email.");
  }

  // 0. button_href is REQUIRED for the structural-button-guarantee
  //    shell. If the caller couldn't build one (NEXT_PUBLIC_SITE_URL
  //    unset in dev), log the misconfig and skip the send — better
  //    than emailing a broken button.
  if (!input.href) {
    console.error(
      "[email] submission notify skipped for",
      input.refCode,
      "— no href supplied (NEXT_PUBLIC_SITE_URL unset?)"
    );
    return { ok: false };
  }

  // 1. Load template customization (if any). A failure here logs but
  //    DOES NOT abort — defaults still produce a working email.
  let storedSubject: string | null = null;
  let storedSections: Partial<Record<SectionKey, string>> | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const row = await getTemplate(admin, "submission");
    if (row) {
      storedSubject = row.subjectEn;
      storedSections = row.sectionsEn;
    }
  } catch (err) {
    console.error(
      "[email] submission template load failed for",
      input.refCode,
      "— falling back to defaults —",
      (err as Error).message
    );
  }

  // 2. Merge with defaults to a complete render-ready template.
  const defaults = getDefaults("submission");
  const localeDefaults = defaults.en; // EN-only template
  const template = resolveTemplate({
    templateId: "submission",
    lang: "en",
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: storedSubject,
    overlaySections: storedSections ?? null,
  });

  // 3. Render. button_href is system-owned — the response-detail URL the
  //    caller built. {ref_code} interpolates the response's ref_code into
  //    the lead paragraph.
  const { subject, text, html } = renderEmailTemplate({
    template,
    values: {
      expiry_date: "", // unused — submission has no expiry placeholder
      ref_code: input.refCode,
      button_href: input.href,
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
      // ref_code + message only — never the recipient address.
      console.error(
        "[email] submission notify failed for",
        input.refCode,
        "—",
        error.message
      );
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      "[email] submission notify threw for",
      input.refCode,
      "—",
      (err as Error).message
    );
    return { ok: false };
  }
}
