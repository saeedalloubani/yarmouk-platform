// components/LandingNoSession.tsx
//
// Public marketing/courtesy page for visitors arriving at / without
// a yarmouk_session cookie. Reached by:
//   - Supervisors, ethics committee, Sura herself when poking the site
//   - Search bots (this is what the site renders for indexers)
//   - Anyone who got the URL second-hand without an invitation
//
// Constraints:
//   - No DB calls; getSession() returned null in the variant chooser
//     before this component was rendered
//   - Both languages stacked (English first, Arabic second) because
//     we don't know the visitor's preference and have no invitation
//     to read preferred_language from
//   - No CTAs that imply an action (no Continue, no language picker,
//     no retry); only the static "Researcher login" link in the
//     header and a mailto for direct contact
//
// Bilingual: the body stacks English then Arabic. `byInvitationOnly`,
// `contactResearcher`, and `ethicsFooter` now carry real Arabic from
// lib/i18n.ts (2026-05-23 pass) and render as normal stacked text — the
// amber-dashed QA placeholders that previously wrapped the first two are
// gone. (The header chrome — study label, researcher login — stays
// English-only by design.)

import Link from "next/link";
import { translations } from "@/lib/i18n";

const CONTACT_EMAIL = "sjkarasneh24@eng.just.edu.jo";
const CONTACT_HREF =
  `mailto:${CONTACT_EMAIL}?subject=Yarmouk%20Study%20inquiry`;

export default function LandingNoSession() {
  return (
    <main className="min-h-screen bg-white">
      {/* Header strip */}
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="text-[14px] font-bold text-ink tracking-tight">
            {translations.studyLabel.en}
          </div>
          <Link href="/admin/login" className="btn-ghost text-[12px]">
            {translations.researcherLogin.en} →
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
        {/* Hero — English */}
        <div lang="en" dir="ltr" className="mb-10">
          <div className="eyebrow mb-4">{translations.eyebrowLanding.en}</div>
          <h1 className="text-[34px] font-bold leading-[1.15] text-ink tracking-tight mb-3">
            {translations.studyTitle.en}
          </h1>
          <p className="text-[17px] text-muted-strong leading-relaxed">
            {translations.studySubtitle.en}
          </p>
        </div>

        {/* Hero — Arabic */}
        <div lang="ar" dir="rtl" className="font-arabic mb-12">
          <div className="eyebrow mb-4">{translations.eyebrowLanding.ar}</div>
          <h1 className="text-[34px] font-bold leading-[1.15] text-ink tracking-tight mb-3">
            {translations.studyTitle.ar}
          </h1>
          <p className="text-[17px] text-muted-strong leading-relaxed">
            {translations.studySubtitle.ar}
          </p>
        </div>

        {/* By-invitation-only paragraph — English */}
        <div lang="en" dir="ltr" className="mb-4">
          <p className="text-[15px] text-muted-strong leading-relaxed">
            {translations.byInvitationOnly.en}
          </p>
        </div>

        {/* By-invitation-only — Arabic (real translation, 2026-05-23). */}
        <div lang="ar" dir="rtl" className="font-arabic mb-10">
          <p className="text-[15px] text-muted-strong leading-relaxed">
            {translations.byInvitationOnly.ar}
          </p>
        </div>

        {/* Contact — English (parallel layout to /invitation-invalid) */}
        <div lang="en" dir="ltr" className="mb-4">
          <p className="text-[15px] text-muted-strong leading-relaxed mb-2">
            {translations.contactResearcher.en}
          </p>
          <p className="text-[14px] text-muted">
            Sura Karasneh —{" "}
            <a
              href={CONTACT_HREF}
              className="mono text-ink underline underline-offset-2 hover:text-brand-700"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>

        {/* Contact — Arabic (real translation, 2026-05-23). */}
        <div lang="ar" dir="rtl" className="font-arabic mb-16">
          <p className="text-[15px] text-muted-strong leading-relaxed">
            {translations.contactResearcher.ar}
          </p>
        </div>

        {/* Ethics footer — bilingual via the ethicsFooter key. */}
        <div className="pt-8 border-t border-line text-[11px] text-muted-faint">
          <span lang="en" dir="ltr">{translations.ethicsFooter.en}</span>
          <span lang="ar" dir="rtl" className="font-arabic block mt-1">
            {translations.ethicsFooter.ar}
          </span>
        </div>
      </div>
    </main>
  );
}
