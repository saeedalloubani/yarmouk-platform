// lib/email/invitation.ts
//
// Respondent invitation email via the Resend API directly (D55) — distinct
// from Supabase auth emails (which use Supabase SMTP). App-controlled
// bilingual content, from/reply-to, and the /r/<token> link.
//
// Invitation email copy is a SEPARATE surface from the web i18n
// (lib/i18n.ts). EN is final. AR currently FALLS BACK to EN — first-
// contact copy with officials must be native-speaker-written by Sura
// (pre-launch item, paired with Resend domain verification; both gate
// real bilingual sends). When real AR copy lands, replace AR's values;
// the preferred_language switch is already wired here.
//
// NEVER logs the recipient address or the token URL.

import { Resend } from "resend";
import type { Lang } from "@/lib/i18n";

const FROM = "Yarmouk Study <onboarding@resend.dev>"; // test sender; real domain pre-launch
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

const EN = {
  subject: "Invitation to the Yarmouk Study questionnaire",
  intro:
    "You have been invited to take part in the Yarmouk Study — a research questionnaire evaluating the 1987 Yarmouk Agreement between Jordan and Syria.",
  cta: "Open your questionnaire:",
  personal: "This link is personal to you. Please do not forward it.",
  expiry: (d: string) => `The link expires on ${d}.`,
  contact: "Questions? Contact Sura Karasneh at sjkarasneh24@eng.just.edu.jo.",
};
// Fallback until Sura supplies Arabic (pre-launch). Switch is wired below.
const AR = EN;

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
  const dir = input.lang === "ar" ? "rtl" : "ltr";
  const expiry = new Date(input.expiresAt).toLocaleDateString(
    input.lang === "ar" ? "ar-JO" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const text = [
    c.intro,
    "",
    `${c.cta} ${input.tokenUrl}`,
    "",
    c.personal,
    c.expiry(expiry),
    "",
    c.contact,
  ].join("\n");

  const html = `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;max-width:520px">
    <p>${c.intro}</p>
    <p><a href="${input.tokenUrl}" style="color:#1e5b8f;font-weight:600">${c.cta}</a></p>
    <p style="font-size:13px;color:#6b7280">${c.personal}<br>${c.expiry(expiry)}</p>
    <p style="font-size:13px;color:#6b7280">${c.contact}</p>
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
      // refCode + message only — never the address or the link. (A Resend
      // message could in theory embed the address; this is a server log,
      // not an audit row — debuggability over paranoia here.)
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
