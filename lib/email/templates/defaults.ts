// lib/email/templates/defaults.ts
//
// D22 — canonical defaults bundled with the codebase. These are the
// strings that ship if no email_templates row exists, or that fill in any
// section the row left blank ("reset to default" deletes the row, so the
// renderer falls back to these).
//
// EXTRACTED BYTE-FOR-BYTE from the pre-D22 lib/email/invitation.ts EN/AR
// objects. The function-shaped `expiry` field becomes a string with the
// {expiry_date} placeholder — once interpolated, the rendered output is
// IDENTICAL to today's hard-coded email. Shipping D22 with no DB row in
// place must not change a single character of what Sura's invitees see.
//
// The HTML chrome (card, button color, line-heights, bidi-isolate spans)
// lives in render.ts, NOT here — defaults carry text only.

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

export const TEMPLATE_DEFAULTS: Record<TemplateId, TemplateDefaults> = {
  invitation: INVITATION,
};

export function getDefaults(id: TemplateId): TemplateDefaults {
  return TEMPLATE_DEFAULTS[id];
}
