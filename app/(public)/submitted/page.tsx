// app/(public)/submitted/page.tsx
//
// Terminal thank-you (Server Component). The session cookie was already
// dropped by submitQuestionnaire (clearSessionCookie) — the lang cookie
// is preserved so this page renders in the respondent's language.
//
// No session read, no DB read, no link back into the flow. Re-entry to
// the questionnaire is impossible anyway: the response is submitted, so
// getSession() returns null and /r/[token] returns invitation-invalid.
//
// Cookie mutation is forbidden during RSC render, so clearing happens in
// the submit action, not here.

import { getLang } from "@/lib/cookies";
import { getTranslations } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SubmittedPage() {
  const lang = await getLang();
  const t = getTranslations(lang);
  const isAr = lang === "ar";

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className={`min-h-screen bg-white flex items-center justify-center px-6 ${
        isAr ? "font-arabic" : ""
      }`}
    >
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-accent-50 flex items-center justify-center mx-auto mb-6">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path
              d="M 8 16 L 14 22 L 24 10"
              stroke="#4a7d63"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="eyebrow mb-3">{t.submissionReceived}</div>
        <h1 className="text-[28px] font-bold text-ink leading-tight mb-4 tracking-tight">
          {t.submittedTitle}
        </h1>
        <p className="text-[15px] text-muted-strong leading-relaxed">
          {t.submittedBody}
        </p>
      </div>
    </main>
  );
}
