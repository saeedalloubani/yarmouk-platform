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
  // D68 — `studyTitle` reworded to the formal thesis-citation phrasing
  // ("Evaluating the 1987 agreement between Jordan and Syria regarding the
  // utilization of Yarmouk River water"). What the eventual thesis chapter
  // + paper title will reference; aligning the landing with the citation
  // language is the right read for invited experts. `eyebrowLanding` lost
  // the "· Pilot Phase" suffix — phase-agnostic going forward. The study
  // IS in pilot, but the respondent's answers stand on their own, not as
  // a dress rehearsal (admin-side "Pilot · Version 1" labels in /admin
  // are intentionally kept; see DECISIONS D68 for the split rationale).
  studyTitle: {
    en: "Evaluating the 1987 agreement between Jordan and Syria regarding the utilization of Yarmouk River water",
    ar: "تقييم اتفاقية عام ١٩٨٧ بين الأردن وسوريا بشأن استغلال مياه نهر اليرموك",
  },
  studySubtitle: {
    en: "in light of International Water Law and Environmental Principles",
    ar: "في ضوء القانون الدولي للمياه والمبادئ البيئية",
  },
  eyebrowLanding: {
    en: "Research Questionnaire",
    ar: "استبيان بحثي",
  },
  invitedAs: { en: "You have been invited as", ar: "تمت دعوتك بصفة" },
  // D67 — per-category "invited as" labels. Pre-D67 there was only
  // `categoryOfficials`; LandingInvited rendered it for ALL category values
  // regardless of the invitation's actual category. D66 smoke (SMOKE-D66-002,
  // category=researchers) surfaced the bug. The 4 keys below are wired
  // through `categoryLabel(category, t)` defined at the bottom of this file;
  // consumers must use the helper, not the keys directly. AR singular/plural
  // mix is intentional (Sura's word choice).
  //
  // D68 — stripped "— Pilot Reviewer" suffix. The participant doesn't need
  // a phase marker on their card; their answers stand on their own. The
  // resulting labels are phase-agnostic and will also serve future main_*
  // variants without rename. NGO Arabic = "منظمات غير حكومية"
  // (non-governmental, NOT "غير ربحية" non-profit — Sura's domain-precision
  // correction from D67 carries forward).
  categoryOfficials: {
    en: "Official",
    ar: "مسؤول",
  },
  categoryResearchers: {
    en: "Researcher",
    ar: "باحث",
  },
  categoryDonors: {
    en: "Donor",
    ar: "جهات مانحة",
  },
  categoryNGOs: {
    en: "NGO Representative",
    ar: "منظمات غير حكومية",
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
  // D67 — per-category pilot badge text. Pre-D67 a single `pilotBadge`
  // key was hardcoded to "Pilot Version 1 · Officials" and rendered on
  // both the live respondent wizard AND the admin preview shell
  // regardless of the actual variant. Path (a) rename: `pilotBadge` was
  // copied verbatim into `pilotBadgeOfficials` AND its 2 consumers
  // migrated to `pilotBadgeLabel(category, t)` in the same commit.
  //
  // D68 — Unused since D68 (the badge was removed from /questionnaire
  // entirely; version tracking is backend-only via questionnaire_version_id).
  // The 4 keys + `pilotBadgeLabel` helper are retained for potential future
  // use; remove in a later cleanup cycle. Intentional dead code.
  pilotBadgeOfficials: {
    en: "Pilot Version 1 · Officials",
    ar: "النسخة التجريبية الأولى · المسؤولون",
  },
  pilotBadgeResearchers: {
    en: "Pilot Version 1 · Researchers",
    ar: "النسخة التجريبية الأولى · الباحثون",
  },
  pilotBadgeDonors: {
    en: "Pilot Version 1 · Donors",
    ar: "النسخة التجريبية الأولى · الجهات المانحة",
  },
  pilotBadgeNGOs: {
    en: "Pilot Version 1 · NGOs",
    ar: "النسخة التجريبية الأولى · منظمات غير حكومية",
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
  // D68 — phase-agnostic. Dropped the "Pilot" prefix on `feedbackSection`
  // and the "before it is sent more widely" trailer on `feedbackIntro`.
  // Same text serves the main study; one set of strings going forward.
  feedbackSection: {
    en: "Feedback",
    ar: "ملاحظات",
  },
  feedbackIntro: {
    en: "These final questions help us refine the questionnaire.",
    ar: "تساعدنا هذه الأسئلة الأخيرة في تحسين الاستبيان.",
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
  // D68 — phase-agnostic ("pilot feedback questions" → "feedback questions"
  // / "أسئلة الملاحظات على النسخة التجريبية" → "أسئلة الملاحظات").
  mapHint: {
    en: "Circles = feedback questions · Locked questions cannot be skipped to",
    ar: "الدوائر = أسئلة الملاحظات · لا يمكن التخطي إلى الأسئلة المقفلة",
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

// ============================================================================
// D67 — Per-category lookup helpers
// ============================================================================
//
// The 4 category enum values (officials, researchers, donors, ngos) each get
// their own "invited as" label on the landing/consent page (via
// `categoryLabel`). Pre-D68 they also drove a per-category pilot badge in the
// questionnaire shell (via `pilotBadgeLabel`); D68 removed that badge from
// `/questionnaire` entirely — `pilotBadgeLabel` survives as dead code per the
// A2 deferred-cleanup carve-out (kept inert; future cleanup pass can drop it
// in one commit alongside the `pilotBadgeX` keys). The DB enum category_type
// carries the same 4 values verbatim; PilotCategory is structurally identical
// to InvitationCategory but documents the call-site assumption (the cast
// `session.category as PilotCategory` is a no-op at runtime).
//
// D68 — the labels are now phase-agnostic (stripped "— Pilot Reviewer"
// suffix). Same helper serves both pilot and main variants without a rename
// or a variant-discriminated dispatch.
//
// The switch-on-union pattern below is DELIBERATE — TypeScript's
// exhaustiveness check enforces that adding a 5th PilotCategory value
// produces a compile error until every helper switch is extended.
// Defensive against future variant churn.

export type PilotCategory = "officials" | "researchers" | "donors" | "ngos";

/**
 * Resolve the per-category "invited as" label for the pilot landing /
 * consent surface. Used by LandingInvited.
 */
export function categoryLabel(
  category: PilotCategory,
  t: Translations
): string {
  switch (category) {
    case "officials":
      return t.categoryOfficials;
    case "researchers":
      return t.categoryResearchers;
    case "donors":
      return t.categoryDonors;
    case "ngos":
      return t.categoryNGOs;
  }
}

/**
 * Resolve the per-category pilot-badge text for the questionnaire shell.
 *
 * Unused since D68 (badge removed from /questionnaire entirely; version
 * tracking is backend-only via questionnaire_version_id). Retained for
 * potential future use; remove in a later cleanup cycle. Intentional dead
 * code — keep paired with the `pilotBadgeX` keys above.
 */
export function pilotBadgeLabel(
  category: PilotCategory,
  t: Translations
): string {
  switch (category) {
    case "officials":
      return t.pilotBadgeOfficials;
    case "researchers":
      return t.pilotBadgeResearchers;
    case "donors":
      return t.pilotBadgeDonors;
    case "ngos":
      return t.pilotBadgeNGOs;
  }
}
