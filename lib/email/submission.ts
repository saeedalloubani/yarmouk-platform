// lib/email/submission.ts
//
// Owner-facing "a response was submitted" email (Session — notifications).
// Reuses the Resend SDK + the conventions established in invitation.ts (D55):
// returns { ok }, throws only on missing RESEND_API_KEY, NEVER logs PII.
//
// ENGLISH ONLY — the admin side is English-only (unlike the bilingual
// respondent invitation). IDENTITY-FREE — references the response by ref_code
// only, NEVER the respondent's name, mirroring the dashboard's discipline.
//
// BEST-EFFORT: the caller (lib/notifications.ts) treats a non-ok / thrown
// result as a logged-but-non-fatal event. With the test sender still in place
// (onboarding@resend.dev only delivers to the account address), sends to any
// other owner come back as a Resend error → { ok: false }; real delivery
// verifies once the domain is set up pre-launch.
//
// FROM / REPLY_TO are RE-DECLARED here rather than imported from
// invitation.ts — deliberately not refactoring a working file. They duplicate
// invitation.ts; a shared lib/email/resend.ts extract is a trivial later
// cleanup (flagged). Both copies must change together when the real Resend
// domain lands pre-launch.

import { Resend } from "resend";

const FROM = "Yarmouk Study <onboarding@resend.dev>"; // test sender; real domain pre-launch
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";

export type SendSubmissionEmailInput = {
  to: string; // an active owner's plaintext admins.email
  refCode: string; // identity-free response key — NEVER the respondent's name
  href?: string; // optional absolute link to the response detail in the console
};

/**
 * Send one submission-notification email to an owner. Returns { ok } — the
 * caller logs a false/threw result distinctly and never lets it affect the
 * respondent's submit. Throws ONLY on missing RESEND_API_KEY (config).
 * Never logs the recipient address.
 */
export async function sendSubmissionEmail(
  input: SendSubmissionEmailInput
): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — cannot send submission email.");
  }

  const subject = "New response submitted — Yarmouk Study";
  const lead = `A new questionnaire response (${input.refCode}) was submitted.`;
  const cta = "Review it in the admin console.";

  const text = input.href
    ? [lead, "", `${cta} ${input.href}`].join("\n")
    : [lead, "", cta].join("\n");

  const html = `<div dir="ltr" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0a0a0a;max-width:520px">
    <p>${lead}</p>
    <p>${
      input.href
        ? `<a href="${input.href}" style="color:#1e5b8f;font-weight:600">${cta}</a>`
        : cta
    }</p>
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
