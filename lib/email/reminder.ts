// lib/email/reminder.ts
//
// D64 — thin wrapper around the template renderer for the two auto-nudge
// reminders dispatched by /api/cron/send-reminders. Mirrors
// lib/email/invitation.ts byte-for-byte; the only difference is a `kind`
// discriminator that picks which template id (reminder1 or reminderFinal)
// to load and which default to fall back to. A single wrapper covers
// both so the failure-surface plumbing (last_send_failed_at writes in
// STEP 6) doesn't need to be duplicated across two near-identical files.
//
// Pipeline:
//   1. Load the customization row from email_templates for this kind.
//   2. Overlay it on the defaults to get a complete ResolvedTemplate.
//   3. Render with the same {expiry_date, ref_code, button_href} runtime
//      values as the invitation.
//   4. Hand the result to Resend.
//
// LOAD-BEARING PROPERTIES (mirror invitation.ts):
//   - NEVER logs the recipient address or the token URL. The cron route
//     keeps the decrypted recipient_email scoped to its innermost loop
//     iteration; the wrapper only reads `input.to` to hand to Resend.
//     console.error strings reference `kind` + `refCode` + `errorClass`,
//     never the recipient and never the raw Resend error.message
//     (which can echo recipient addresses).
//   - throws ONLY on missing RESEND_API_KEY (config). The cron route's
//     try/catch buckets that to errorClass='config' for its audit row.
//     All other failures return { ok: false, errorClass } so the cron
//     can decide surfacing (mark the row failed in last_send_failed_at;
//     the missing reminder*_sent_at stamp makes the next cron run retry
//     naturally).
//
// TEMPLATE LOAD is via service-role admin client. The email_templates
// row holds non-PII configuration; service-role bypasses RLS (fine since
// the cron route already uses service-role for the decrypt + dispatch).
// A read failure DOES NOT abort the send — it falls through to defaults,
// so a transient DB hiccup never deprives a respondent of their reminder.
//
// IDEMPOTENCY NOTE — the wrapper does NOT stamp reminder1_sent_at /
// reminder_final_sent_at. That's the cron route's job (post-OK only,
// see 20260601130001 migration header). Stamping here would couple the
// "did we send?" decision to the "did we record we sent?" decision in a
// way that breaks the retry-after-Resend-failure flow.

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

/** Which auto-nudge this send is. Drives the template id (and downstream,
 *  the cron route's { kind → reminder*_sent_at column } translation). */
export type ReminderKind = "reminder1" | "reminderFinal";

export type SendReminderEmailInput = {
  to: string;
  lang: Lang;
  refCode: string;
  tokenUrl: string;
  expiresAt: string; // ISO
  kind: ReminderKind;
  /** D66 — 6-digit participant access code (URL-prefetch fallback).
   *  Decrypted from invitations.access_code_encrypted by the cron's
   *  per-row loop (scoped to the iteration; NEVER logged, NEVER
   *  audited). Interpolated into the {access_code} REQUIRED placeholder
   *  on reminder1 + reminderFinal. */
  accessCode: string;
  /** D72 — plaintext recipient name for the {name} placeholder in the
   *  intro section (ALLOWED, not required). Decrypted from
   *  invitations.recipient_name_encrypted by the cron's per-row loop
   *  alongside email + token + access_code; scoped to the iteration,
   *  NEVER logged, NEVER audited. Optional in the type: a decrypt
   *  failure for `name` is NON-FATAL (degrade to empty) because the
   *  reminder is still deliverable; an empty `Hello ,` is uglier than
   *  ideal but the participant still gets their link, which is the
   *  load-bearing goal. Contrast with email/token/access_code where
   *  decrypt failure aborts the send (those are not optional). */
  name?: string | null;
};

/**
 * Send one reminder email (reminder1 or reminderFinal). Returns
 * EmailSendResult — the cron route decides how a failure surfaces
 * (writes last_send_failed_at on the invitations row; the missing
 * reminder*_sent_at stamp makes the next cron run retry naturally).
 * `errorClass` buckets the failure for audit metadata without carrying
 * raw Resend error.message. Throws only on missing RESEND_API_KEY
 * (config); the cron's catch buckets it to errorClass='config'. Never
 * logs the recipient address or the token URL.
 */
export async function sendReminderEmail(
  input: SendReminderEmailInput
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — cannot send reminder email.");
  }

  // 1. Load template customization (if any) for THIS kind. A failure
  //    here logs but DOES NOT abort — defaults still produce a working
  //    email.
  let storedSubject: string | null = null;
  let storedSections: Partial<Record<string, string>> | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const row = await getTemplate(admin, input.kind);
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
    // D64 — log the bucket, not the raw message. Template-load
    // failure is non-aborting; defaults still produce a working email.
    console.error(
      "[email] reminder template load failed for",
      input.kind,
      input.refCode,
      "errorClass=config (non-aborting; falling back to defaults)"
    );
  }

  // 2. Merge with defaults to a complete render-ready template.
  const defaults = getDefaults(input.kind);
  const localeDefaults = input.lang === "ar" ? defaults.ar : defaults.en;
  if (!localeDefaults) {
    // Should never happen — both reminders are bilingual. Defensive
    // log + 'config' failure beats a thrown undefined-dereference.
    console.error(
      "[email] reminder defaults missing for",
      input.kind,
      input.refCode,
      "lang",
      input.lang,
      "errorClass=config"
    );
    return { ok: false, errorClass: "config" };
  }
  const template = resolveTemplate({
    templateId: input.kind,
    lang: input.lang,
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: storedSubject,
    overlaySections: storedSections ?? null,
  });

  // 3. Format the expiry date per locale (same as the invitation wrapper).
  const isAr = input.lang === "ar";
  const expiry_date = new Date(input.expiresAt).toLocaleDateString(
    isAr ? "ar-JO" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  // 4. Render. button_href is system-owned — it's the real token URL the
  //    cron route built via lib/tokens.ts. The renderer wraps it in the
  //    fixed-shell button; the editor surface never sees it.
  const { subject, text, html } = renderEmailTemplate({
    template,
    values: {
      // D72 — pass plaintext name (or empty if cron decrypt failed). The
      // reminder body's {name} placeholder is allowed-only; an empty
      // value renders harmlessly for templates that don't reference it.
      name: input.name ?? "",
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
      // D64 — bucket only; Resend's error.message can echo recipient.
      console.error(
        "[email] reminder send failed for",
        input.kind,
        input.refCode,
        "errorClass=send"
      );
      return { ok: false, errorClass: "send" };
    }
    return { ok: true };
  } catch {
    console.error(
      "[email] reminder send threw for",
      input.kind,
      input.refCode,
      "errorClass=send"
    );
    return { ok: false, errorClass: "send" };
  }
}
