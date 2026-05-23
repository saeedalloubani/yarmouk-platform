// lib/email/invitation.ts
//
// Respondent invitation email via the Resend API directly (D55) — distinct
// from Supabase auth emails (which use Supabase SMTP). App-controlled
// bilingual content, from/reply-to, and the /r/<token> link.
//
// Invitation email copy is a SEPARATE surface from the web i18n
// (lib/i18n.ts). Both EN and AR are now real, Sura-supplied copy (2026-05-23);
// the dir flip below renders the chosen language LTR/RTL. The contact line's
// email + phone are LTR runs — inside the RTL (AR) HTML they're wrapped with
// dir="ltr" + unicode-bidi:isolate so the Latin address and +962 digits don't
// reorder (same fix as the landing contact lines). Copy strings stay verbatim;
// the HTML linkifies the email/phone via a targeted replace.
//
// NEVER logs the recipient address or the token URL.

import { Resend } from "resend";
import type { Lang } from "@/lib/i18n";

const FROM = "Yarmouk Study <noreply@karasneh-research.org>"; // verified production sender (karasneh-research.org)
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

// Contact-line atoms — consts so the HTML can linkify + bidi-isolate the
// email/phone within the (otherwise verbatim) contact sentence.
const CONTACT_EMAIL = "sjkarasneh24@eng.just.edu.jo";
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;
const CONTACT_PHONE = "+962 7 9661 0400";
const CONTACT_PHONE_HREF = "tel:+962796610400";

const EN = {
  subject: "Invitation to the Yarmouk Study questionnaire",
  intro:
    "You have been invited to take part in the Yarmouk Study — a research questionnaire evaluating the 1987 Yarmouk Agreement between Jordan and Syria.",
  cta: "Open the questionnaire",
  personal: "This link is personal to you. Please do not forward it.",
  expiry: (d: string) => `The link expires on ${d}.`,
  contact:
    "Questions? Contact Sura Karasneh at sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
};

const AR = {
  subject: "دعوة للمشاركة في استبيان دراسة اليرموك",
  intro:
    "تمت دعوتك للمشاركة في دراسة اليرموك — وهي استبيان بحثي يُقيّم اتفاقية اليرموك لعام 1987 بين الأردن وسوريا.",
  cta: "افتح الاستبيان",
  personal: "هذا الرابط خاص بك، يُرجى عدم إعادة توجيهه.",
  expiry: (d: string) => `تنتهي صلاحية هذا الرابط في ${d}.`,
  contact:
    "لأي استفسار، يُرجى التواصل مع الباحثة سرى كراسنة على البريد الإلكتروني sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
};

function copy(lang: Lang) {
  return lang === "ar" ? AR : EN;
}

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

  const c = copy(input.lang);
  const isAr = input.lang === "ar";
  const dir = isAr ? "rtl" : "ltr";
  const introLh = isAr ? "1.85" : "1.7";
  const fineLh = isAr ? "1.7" : "1.6";
  const expiry = new Date(input.expiresAt).toLocaleDateString(
    isAr ? "ar-JO" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  // Plain text: clean button label + raw URL on the next line. No bidi
  // isolation needed (plain text has no layout).
  const text = [
    c.intro,
    "",
    `${c.cta}:`,
    input.tokenUrl,
    "",
    c.personal,
    c.expiry(expiry),
    "",
    c.contact,
  ].join("\n");

  // Linkify + LTR-isolate the email/phone inside the verbatim contact
  // sentence. dir="ltr" + unicode-bidi:isolate keeps them from reordering in
  // the RTL (AR) layout; harmless in LTR.
  const contactHtml = c.contact
    .replace(
      CONTACT_EMAIL,
      `<a href="${CONTACT_EMAIL_HREF}" dir="ltr" style="unicode-bidi:isolate;color:#185FA5;text-decoration:none">${CONTACT_EMAIL}</a>`
    )
    .replace(
      CONTACT_PHONE,
      `<a href="${CONTACT_PHONE_HREF}" dir="ltr" style="unicode-bidi:isolate;color:#185FA5;text-decoration:none">${CONTACT_PHONE}</a>`
    );

  const html = `<div dir="${dir}" style="margin:0 auto;max-width:520px;background:#ffffff;border:0.5px solid #e6e4de;border-radius:12px;padding:32px 34px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#33322f">
    <p style="margin:0 0 26px;font-size:16px;line-height:${introLh};color:#33322f">${c.intro}</p>
    <p style="margin:0 0 28px">
      <a href="${input.tokenUrl}" style="display:inline-block;background:#185FA5;color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;padding:13px 30px;border-radius:8px">${c.cta}</a>
    </p>
    <div style="border-top:0.5px solid #ececea;padding-top:18px">
      <p style="margin:0;font-size:13px;line-height:${fineLh};color:#8a8982">${c.personal}</p>
      <p style="margin:4px 0 0;font-size:13px;line-height:${fineLh};color:#8a8982">${c.expiry(expiry)}</p>
      <p style="margin:12px 0 0;font-size:14px;line-height:${fineLh};color:#5f5e59">${contactHtml}</p>
    </div>
  </div>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      replyTo: REPLY_TO,
      subject: c.subject,
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
