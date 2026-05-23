// lib/i18n.ts
//
// Source of truth for i18n strings. The mock copy in
// ~/Downloads/yarmouk-mock/lib/i18n.ts is no longer authoritative
// once this file exists.
//
// Both languages required for every key. If a key is added later
// without Arabic, it's an explicit TODO — never default to English.
//
// Arabic strings ported verbatim from the mock (lib/i18n.ts and
// inline strings in app/page.tsx). No AI translation, no edits.
// Same provenance rule as the questionnaire seed.
//
// Type strategy: `translations` is an `as const` literal so its keys
// become a literal union via `keyof typeof translations`. Typo'd
// access at a call site is a compile error. Flat namespace (no
// nested t.consent.intro) — premature for ~40 strings; revisit if
// we cross ~150.
//
// Arabic completeness pass (2026-05-23): the previously-deferred
// strings now carry Sura-supplied Arabic. `byInvitationOnly` and
// `contactResearcher` (below) hold real Arabic — the amber-dashed
// placeholder boxes that wrapped them on the no-session landing have
// been removed. `ethicsFooter` is now a key in this file (added
// below), rendered bilingually on both landing variants. `invalidTitle`
// / `invalidBody` are translated inline on `/invitation-invalid` (that
// page resolves no Lang, so its strings stay hardcoded there, not keyed
// here). Provenance rule unchanged: Arabic is Sura's, no AI translation.
//
// `Lang` is the canonical literal-union home (server- and client-
// safe; this file imports nothing from next/headers). lib/cookies.ts
// re-exports it so existing consumers can continue importing
// `type Lang` from there.
//
// Usage:
//   import { getLang } from "@/lib/cookies";
//   import { getTranslations } from "@/lib/i18n";
//
//   const lang = await getLang();
//   const t = getTranslations(lang);
//   <h1>{t.studyTitle}</h1>

export type Lang = "en" | "ar";

export const translations = {
  // ---- common chrome ----
  studyLabel: { en: "Yarmouk Study", ar: "دراسة اليرموك" },
  researcherLogin: { en: "Researcher login", ar: "دخول الباحثة" },

  // ---- landing page ----
  studyTitle: {
    en: "Evaluating the 1987 Yarmouk Agreement",
    ar: "تقييم اتفاقية اليرموك لعام 1987",
  },
  studySubtitle: {
    en: "in light of International Water Law and Environmental Principles",
    ar: "في ضوء القانون الدولي للمياه والمبادئ البيئية",
  },
  eyebrowLanding: {
    en: "Research Questionnaire · Pilot Phase",
    ar: "استبيان بحثي · المرحلة التجريبية",
  },
  invitedAs: { en: "You have been invited as", ar: "تمت دعوتك بصفة" },
  categoryOfficials: {
    en: "Official — Pilot Reviewer",
    ar: "مسؤول — مراجع للنسخة التجريبية",
  },
  selectLanguage: {
    en: "Choose your preferred language",
    ar: "اختر لغتك المفضلة",
  },
  estimatedTime: {
    en: "Approx. 35–50 minutes",
    ar: "حوالي ٣٥ إلى ٥٠ دقيقة",
  },

  // ---- landing page (no-session variant) ----
  byInvitationOnly: {
    en: "This study is conducted by invitation only. If you received an invitation, please use the link in your email. Otherwise, please contact the researcher.",
    ar: "هذه الدراسة بدعوة فقط. إذا تلقيت دعوة، يُرجى استخدام الرابط الموجود في بريدك الإلكتروني. وإلا، يُرجى التواصل مع الباحثة.",
  },
  contactResearcher: {
    en: "Contact the researcher:",
    ar: "للتواصل مع الباحثة:",
  },

  // ---- landing footer (both variants) ----
  ethicsFooter: {
    en: "Ethics approval reference on file with the researcher.",
    ar: "رقم الموافقة الأخلاقية محفوظ لدى الباحثة.",
  },

  // ---- consent ----
  consent: { en: "Informed Consent", ar: "نموذج الموافقة" },
  consentRead: {
    en: "Please read the information below carefully before proceeding.",
    ar: "يرجى قراءة المعلومات التالية بعناية قبل المتابعة.",
  },
  purpose: { en: "Purpose of the study", ar: "الغرض من الدراسة" },
  purposeText: {
    en: "This research evaluates the 1987 Agreement between Jordan and Syria concerning the utilization of the Yarmouk River. The study aims to identify gaps in the current framework and propose recommendations to enhance cooperative basin management.",
    ar: "يقيّم هذا البحث اتفاقية عام 1987 بين الأردن وسوريا بشأن استغلال نهر اليرموك. تهدف الدراسة إلى تحديد الثغرات وتقديم توصيات لتعزيز الإدارة التعاونية للحوض.",
  },
  whatWeAsk: { en: "What we ask of you", ar: "ما هو المطلوب منك" },
  whatWeAskText: {
    en: "You will complete a questionnaire of open-ended questions. It takes approximately 35–50 minutes. You may answer in Arabic or English, and you may save and resume at any time.",
    ar: "ستكمل استبياناً يحتوي على أسئلة مفتوحة. يستغرق ما بين ٣٥ إلى ٥٠ دقيقة. يمكنك الإجابة بالعربية أو الإنجليزية والحفظ والمتابعة لاحقاً في أي وقت.",
  },
  confidentiality: { en: "Confidentiality", ar: "السرية" },
  confidentialityText: {
    en: "Your responses are confidential and will be anonymized for analysis. Identifying information is stored separately from responses and is accessible only to the researcher. Data is retained for two years following thesis defense and then permanently deleted.",
    ar: "إجاباتك سرية وسيتم إخفاء هويتها لأغراض التحليل. تُخزَّن المعلومات الشخصية بشكل منفصل عن الإجابات ولا يطّلع عليها إلا الباحثة. تُحتفظ البيانات لمدة عامين بعد مناقشة الأطروحة ثم تُحذف بشكل دائم.",
  },
  iConfirm: { en: "I confirm that", ar: "أؤكد أنني" },
  agreeRead: {
    en: "I have read and understood the information above.",
    ar: "قرأت وفهمت المعلومات الواردة أعلاه.",
  },
  agreeParticipate: {
    en: "I agree to participate in this study.",
    ar: "أوافق على المشاركة في هذه الدراسة.",
  },
  fullName: { en: "Full name", ar: "الاسم الكامل" },
  todayDate: { en: "Date", ar: "التاريخ" },
  signAndContinue: { en: "Sign and Continue", ar: "التوقيع والمتابعة" },
  back: { en: "Back", ar: "رجوع" },

  // ---- questionnaire ----
  questionnaire: { en: "Questionnaire", ar: "الاستبيان" },
  pilotBadge: {
    en: "Pilot Version 1 · Officials",
    ar: "النسخة التجريبية الأولى · المسؤولون",
  },
  question: { en: "Question", ar: "السؤال" },
  of: { en: "of", ar: "من" },
  saved: { en: "Saved", ar: "تم الحفظ" },
  saving: { en: "Saving…", ar: "جاري الحفظ…" },
  writeAnswer: { en: "Write your answer here…", ar: "اكتب إجابتك هنا…" },
  previous: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  saveAndExit: { en: "Save & Exit", ar: "حفظ والخروج" },
  submit: { en: "Submit Questionnaire", ar: "إرسال الاستبيان" },
  feedbackSection: {
    en: "Pilot Feedback",
    ar: "ملاحظات على النسخة التجريبية",
  },
  feedbackIntro: {
    en: "These final questions help us refine the questionnaire before it is sent more widely.",
    ar: "تساعدنا هذه الأسئلة الأخيرة في تحسين الاستبيان قبل توزيعه على نطاق أوسع.",
  },

  // ---- submitted ----
  submissionReceived: { en: "Submission Received", ar: "تم الاستلام" },
  submittedTitle: {
    en: "Thank you for your contribution.",
    ar: "شكراً لمساهمتك.",
  },
  submittedBody: {
    en: "Your responses have been recorded. The researcher may follow up by email if any clarification is needed.",
    ar: "تم تسجيل إجاباتك. قد تتواصل معك الباحثة عبر البريد الإلكتروني إذا احتاجت إلى أي توضيح.",
  },

  // ---- consent (audio section + chrome; Arabic verbatim from mock) ----
  step1of3: { en: "Step 1 of 3", ar: "خطوة ١ من ٣" },
  audioSectionTitle: {
    en: "Audio Recording (optional)",
    ar: "تسجيل المقابلات (اختياري)",
  },
  audioSectionBody: {
    en: "If administered as an interview, the researcher may request permission to audio-record for transcription.",
    ar: "إذا تم إجراء الاستبيان كمقابلة، قد تطلب الباحثة الإذن بالتسجيل الصوتي لأغراض النسخ.",
  },
  audioAgree: {
    en: "I agree to be audio-recorded.",
    ar: "أوافق على التسجيل الصوتي.",
  },
  audioDecline: {
    en: "I do NOT agree to be recorded (written notes only).",
    ar: "لا أوافق على التسجيل (ملاحظات مكتوبة فقط).",
  },
  fullNamePlaceholder: {
    en: "Your name as it appears officially",
    ar: "الاسم كما يظهر رسمياً",
  },

  // ---- questionnaire chrome (Arabic verbatim from mock) ----
  requiredMark: { en: "* Required", ar: "* مطلوب" },
  answeredStatus: { en: "Answered", ar: "تم" },
  answeredCountLabel: { en: "answered", ar: "تمت الإجابة" },
  writeBeforeContinuing: {
    en: "Write an answer before continuing",
    ar: "اكتب إجابة قبل المتابعة",
  },
  requiredHintTitle: {
    en: "This question is required.",
    ar: "هذا السؤال مطلوب.",
  },
  requiredHintBody: {
    en: 'Please provide an answer before continuing. If you have nothing to add, you may write "N/A" or a brief note.',
    ar: 'يرجى تقديم إجابة قبل المتابعة. إذا لم يكن لديك إجابة، يمكنك كتابة "لا ينطبق" أو ملاحظة موجزة.',
  },
  wordOne: { en: "word", ar: "كلمة" },
  wordMany: { en: "words", ar: "كلمة" },
  questionMap: { en: "Question map", ar: "خريطة الأسئلة" },
  mapLegendAnswered: { en: "Answered", ar: "تمت الإجابة" },
  mapLegendCurrent: { en: "Current", ar: "حالي" },
  mapLegendLocked: { en: "Locked", ar: "مقفل" },
  mapHint: {
    en: "Circles = pilot feedback questions · Locked questions cannot be skipped to",
    ar: "الدوائر = أسئلة الملاحظات على النسخة التجريبية · لا يمكن التخطي إلى الأسئلة المقفلة",
  },
  completePrevFirst: {
    en: "Complete previous questions first",
    ar: "أكمل الأسئلة السابقة أولاً",
  },

  // ---- net-new interactive strings (error/friction paths) ----
  // These surface in error/friction paths (submit-with-blanks warning,
  // consent save failure). They originally shipped English-fallback
  // (ar mirrored en) rather than a visible sentinel — a bracketed
  // placeholder at a moment of friction is the worst UX. As of the
  // 2026-05-23 Arabic pass they now carry real Arabic (Sura-supplied).
  // Retained principle for any FUTURE deferred key: static dead-end
  // strings get a visible placeholder; interactive in-flow strings get
  // English-fallback, never a sentinel.
  submitMissingTitle: {
    en: "Please answer all required questions before submitting. Still blank:",
    ar: "يُرجى الإجابة على جميع الأسئلة المطلوبة قبل الإرسال. الأسئلة غير المُجابة:",
  },
  consentError: {
    en: "Could not save your consent. Please try again.",
    ar: "تعذّر حفظ موافقتك. يُرجى المحاولة مرة أخرى.",
  },
} as const;

export type TranslationKey = keyof typeof translations;
export type Translations = Record<TranslationKey, string>;

// Language picker button labels — always self-named regardless of
// current language. "Continue in English" reads in English even if
// the surrounding page is Arabic, because that's what the button
// does. Same principle as the LanguageSwitcher buttons being
// hardcoded ("English" / "العربية").
export const LANG_PICKER_LABELS = {
  en: { primary: "Continue in English" },
  ar: { primary: "المتابعة بالعربية" },
} as const;

/**
 * Return the resolved string-for-this-language sub-object. Works
 * identically in Server and Client Components — no React hook
 * machinery.
 *
 * Re-keys the translations table in O(n) on each call (n=36, sub-
 * microsecond). Not worth caching at this scale; if a page reads
 * the same `t` object many times across deeply-nested components,
 * pass `t` down as a prop rather than re-calling getTranslations.
 */
export function getTranslations(lang: Lang): Translations {
  const out = {} as Translations;
  for (const key of Object.keys(translations) as TranslationKey[]) {
    out[key] = translations[key][lang];
  }
  return out;
}
