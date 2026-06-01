// lib/email/templates/defaults.ts
//
// D22 + Stage 2 — canonical defaults bundled with the codebase. These
// are the strings that ship if no email_templates row exists, or that
// fill in any section the row left blank ("reset to default" deletes
// the row, so the renderer falls back to these).
//
// EXTRACTED BYTE-FOR-BYTE from the corresponding pre-Stage-2 modules:
//   - INVITATION       ← lib/email/invitation.ts (Stage 1 — already
//                        extracted in D22; unchanged here).
//   - ADMIN_INVITE     ← lib/email/admin-invite.ts (subject, greeting
//                        "Hello {input.name},", intro, cta "Sign in",
//                        fine → renamed to 'notice', contact).
//   - SUBMISSION       ← lib/email/submission.ts (subject, lead
//                        "A new questionnaire response (…) was
//                        submitted." → ${input.refCode} expressed as
//                        the {ref_code} placeholder, cta "Review it in
//                        the admin console" — trailing period dropped
//                        because the renderer renders the button label
//                        followed by ":" + URL on the next line; a
//                        ".:" pair would read poorly).
//
// D64 — REMINDER_1 + REMINDER_FINAL are NEW defaults (not extracted from
// pre-existing code). They reuse INVITATION's personal/expiry/contact
// sections verbatim so the brand voice stays consistent across the
// 3-email cycle (invitation → 7d nudge → 14d final). Only the `intro`
// and `subject` differ. Each template has its own DB row, so Sura can
// edit them independently — the shared-default text is a starting point,
// not a binding. Sura SHOULD review and lightly edit the reminder copy
// before any real participant send; the defaults bar is "good enough she
// can edit, not rewrite."
//
// Function-shaped placeholders in the source modules become
// {placeholder_token} strings here:
//   - admin-invite "Hello ${input.name},"  →  greeting "Hello {name},"
//   - submission   "(${input.refCode})"     →  lead "({ref_code})"
//
// Once the renderer substitutes runtime values, the rendered EMAIL
// BODY TEXT is byte-equivalent to the pre-Stage-2 hardcoded output for
// every template. The HTML CHROME (card, button, divider) unifies to
// the Stage 1 invitation shell — see lib/email/templates/render.ts
// header for the chrome-delta notes (admin-invite intro paragraph
// font-size 15→16 px; greeting paragraph adopts the intro paragraph's
// 26px bottom margin; submission gains the white card + divider-less
// fine block). All deltas are typographic / imperceptible / brand-
// uniform improvements.
//
// The HTML chrome lives in render.ts, NOT here — defaults carry text
// only.

import type { TemplateDefaults, TemplateId } from "./types";

const INVITATION: TemplateDefaults = {
  name: "Participant invitation",
  description:
    "Sent to invited experts. Bilingual (English + Arabic). Includes the personal sign-in button.",
  en: {
    subject: "Invitation to the Yarmouk Study questionnaire",
    sections: {
      intro:
        "You have been invited to take part in the Yarmouk Study — a research questionnaire evaluating the 1987 Yarmouk Agreement between Jordan and Syria.",
      cta: "Open the questionnaire",
      personal: "This link is personal to you. Please do not forward it.",
      expiry: "The link expires on {expiry_date}.",
      contact:
        "Questions? Contact Sura Karasneh at sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
  ar: {
    subject: "دعوة للمشاركة في استبيان دراسة اليرموك",
    sections: {
      intro:
        "تمت دعوتك للمشاركة في دراسة اليرموك — وهي استبيان بحثي يُقيّم اتفاقية اليرموك لعام 1987 بين الأردن وسوريا.",
      cta: "افتح الاستبيان",
      personal: "هذا الرابط خاص بك، يُرجى عدم إعادة توجيهه.",
      expiry: "تنتهي صلاحية هذا الرابط في {expiry_date}.",
      contact:
        "لأي استفسار، يُرجى التواصل مع الباحثة سرى كراسنة على البريد الإلكتروني sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
};

const REMINDER_1: TemplateDefaults = {
  name: "First reminder",
  description:
    "Auto-sent ~7 days after the invitation if the respondent hasn't submitted. Bilingual (English + Arabic). Same personal sign-in button as the invitation.",
  en: {
    subject: "Reminder — Yarmouk Study questionnaire",
    sections: {
      intro:
        "This is a friendly reminder that you were recently invited to take part in the Yarmouk Study — a research questionnaire evaluating the 1987 Yarmouk Agreement between Jordan and Syria. Your link is still active.",
      cta: "Open the questionnaire",
      personal: "This link is personal to you. Please do not forward it.",
      expiry: "The link expires on {expiry_date}.",
      contact:
        "Questions? Contact Sura Karasneh at sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
  ar: {
    subject: "تذكير — استبيان دراسة اليرموك",
    sections: {
      intro:
        "تذكير لطيف بأنه تمت دعوتك مؤخرًا للمشاركة في دراسة اليرموك — وهي استبيان بحثي يُقيّم اتفاقية اليرموك لعام 1987 بين الأردن وسوريا. لا يزال الرابط الخاص بك فعّالًا.",
      cta: "افتح الاستبيان",
      personal: "هذا الرابط خاص بك، يُرجى عدم إعادة توجيهه.",
      expiry: "تنتهي صلاحية هذا الرابط في {expiry_date}.",
      contact:
        "لأي استفسار، يُرجى التواصل مع الباحثة سرى كراسنة على البريد الإلكتروني sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
};

const REMINDER_FINAL: TemplateDefaults = {
  name: "Final reminder",
  description:
    "Auto-sent ~14 days after the invitation if the respondent still hasn't submitted. Bilingual (English + Arabic). Last automated nudge in the cycle.",
  en: {
    subject: "Final reminder — Yarmouk Study questionnaire",
    sections: {
      intro:
        "This is a final reminder to take part in the Yarmouk Study — a research questionnaire evaluating the 1987 Yarmouk Agreement between Jordan and Syria. Your link is still active, and your perspective would be valuable.",
      cta: "Open the questionnaire",
      personal: "This link is personal to you. Please do not forward it.",
      expiry: "The link expires on {expiry_date}.",
      contact:
        "Questions? Contact Sura Karasneh at sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
  ar: {
    subject: "تذكير أخير — استبيان دراسة اليرموك",
    sections: {
      intro:
        "تذكير أخير للمشاركة في دراسة اليرموك — وهي استبيان بحثي يُقيّم اتفاقية اليرموك لعام 1987 بين الأردن وسوريا. لا يزال الرابط الخاص بك فعّالًا، ورأيك يهمنا.",
      cta: "افتح الاستبيان",
      personal: "هذا الرابط خاص بك، يُرجى عدم إعادة توجيهه.",
      expiry: "تنتهي صلاحية هذا الرابط في {expiry_date}.",
      contact:
        "لأي استفسار، يُرجى التواصل مع الباحثة سرى كراسنة على البريد الإلكتروني sjkarasneh24@eng.just.edu.jo — +962 7 9661 0400.",
    },
  },
};

const ADMIN_INVITE: TemplateDefaults = {
  name: "Supervisor invitation",
  description:
    "Sent when you add a read-only supervisor. English only. Includes the magic-link sign-in button.",
  en: {
    subject: "You've been added as a supervisor on the Yarmouk Study",
    sections: {
      greeting: "Hello {name},",
      intro:
        "Sura Karasneh has added you as a read-only supervisor on the Yarmouk Study research platform. You'll be able to review responses, themes, and analytics — but not edit questionnaires or send invitations.",
      cta: "Sign in",
      notice:
        "This link signs you in. It expires shortly — open it on a device you'll use for the admin console. If you weren't expecting this, ignore it; no account is active until you click.",
      contact:
        "Questions? Reply to this email or contact Sura at sjkarasneh24@eng.just.edu.jo.",
    },
  },
  ar: null,
};

const SUBMISSION: TemplateDefaults = {
  name: "Submission notification",
  description:
    "Sent to active owners when a respondent submits. English only. Identity-free — references the response by ref code.",
  en: {
    subject: "New response submitted — Yarmouk Study",
    sections: {
      lead: "A new questionnaire response ({ref_code}) was submitted.",
      cta: "Review it in the admin console",
    },
  },
  ar: null,
};

export const TEMPLATE_DEFAULTS: Record<TemplateId, TemplateDefaults> = {
  invitation: INVITATION,
  reminder1: REMINDER_1,
  reminderFinal: REMINDER_FINAL,
  "admin-invite": ADMIN_INVITE,
  submission: SUBMISSION,
};

export function getDefaults(id: TemplateId): TemplateDefaults {
  return TEMPLATE_DEFAULTS[id];
}
