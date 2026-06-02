// components/LandingInvited.tsx
//
// Invited respondent landing — single-language render based on the
// resolved getLang() value. Reached after /r/[token] successfully
// claims an invitation and sets yarmouk_session.
//
// The mock's app/page.tsx is the visual reference. Key adaptations:
//   - Display strings come from getTranslations(lang) instead of
//     the mock's useLang() context
//   - ref_code chip reads session.refCode (mock had it hardcoded)
//   - The Continue button text comes from LANG_PICKER_LABELS[lang]
//     .primary (self-named: "Continue in English" or "المتابعة
//     بالعربية"), not from t.continueEn / t.continueAr
//   - The two language buttons (mock's body grid) are static in
//     this file; file 6 swaps them for the <LanguageSwitcher />
//     client component
//
// D67 — Per-category "invited as" label. Pre-D67 this file hardcoded
// `t.categoryOfficials` regardless of session.category; D66 smoke
// (SMOKE-D66-002, category=researchers) caught the bug. The 4 pilot
// categories now route through `categoryLabel(category, t)` from
// lib/i18n. Main-variant labels ("— Main Study Participant" suffix vs
// the current "— Pilot Reviewer") are D68 backlog.

import Link from "next/link";
import {
  getTranslations,
  LANG_PICKER_LABELS,
  categoryLabel,
  type PilotCategory,
} from "@/lib/i18n";
import { getLang } from "@/lib/cookies";
import type { Session } from "@/lib/cookies";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default async function LandingInvited({
  session,
}: {
  session: Session;
}) {
  const lang = await getLang();
  const t = getTranslations(lang);
  const isAr = lang === "ar";
  const continueLabel = LANG_PICKER_LABELS[lang].primary;

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className={`min-h-screen bg-white ${isAr ? "font-arabic" : ""}`}
    >
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="text-[14px] font-bold text-ink tracking-tight">
            {t.studyLabel}
          </div>
          <Link href="/admin/login" className="btn-ghost text-[12px]">
            {t.researcherLogin} →
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        <div className="eyebrow mb-4">{t.eyebrowLanding}</div>

        <h1 className="text-[34px] font-bold leading-[1.15] text-ink tracking-tight mb-3">
          {t.studyTitle}
        </h1>
        <p className="text-[17px] text-muted-strong leading-relaxed mb-10">
          {t.studySubtitle}
        </p>

        <div className="card p-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="label mb-1">{t.invitedAs}</div>
              {/* D67 — per-category lookup. session.category is one of the
                  4 pilot category enum values; the `as PilotCategory` cast
                  is structurally a no-op but documents the pilot-context
                  assumption. When D68 ships main_* support, the cast will
                  be replaced by a variant-aware dispatch. */}
              <div className="text-[18px] font-semibold text-ink">
                {categoryLabel(session.category as PilotCategory, t)}
              </div>
            </div>
            <span className="chip-solid bg-brand-50 text-brand-700 mono">
              {session.refCode}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[13px] text-muted">
            <ClockIcon />
            {t.estimatedTime}
          </div>
        </div>

        <div className="mb-8">
          <div className="label mb-3">{t.selectLanguage}</div>
          <LanguageSwitcher currentLang={lang} />
        </div>

        <Link href="/consent" className="btn-primary">
          {continueLabel}
          <Arrow />
        </Link>

        {/* Ethics footer — follows the active language via ethicsFooter. */}
        <div className="mt-16 pt-8 border-t border-line text-[11px] text-muted-faint">
          {t.ethicsFooter}
        </div>
      </div>
    </main>
  );
}

function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="rtl:rotate-180"
    >
      <path
        d="M 3 8 L 13 8 M 9 4 L 13 8 L 9 12"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="#6b7280" strokeWidth="1.2" />
      <path
        d="M 8 4.5 V 8 L 10.5 9.5"
        stroke="#6b7280"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

