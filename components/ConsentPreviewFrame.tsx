"use client";

// components/ConsentPreviewFrame.tsx
//
// D105a — OWNER-ONLY, ZERO-WRITE preview of the consent screen. Wraps the real
// ConsentForm in `preview` mode (Sign is INERT — no submitConsent, no
// consent_records write, no token/response). Mirrors the questionnaire
// "Preview as respondent" chrome: an always-LTR admin bar (PREVIEW chip +
// label + "nothing is saved" + EN/AR toggle + back-to-editor), then the
// faithful respondent consent render below.
//
// It renders the SAME ConsentForm respondents see (no duplication), so it is a
// true-fidelity proof of wording + the 5 declarations + the audio agree/decline
// radio. EN/AR is LOCAL state here (no cookie write) — the real consent screen
// takes its language from the cookie; this lets the owner flip both languages.

import { useState } from "react";
import Link from "next/link";
import { type Lang } from "@/lib/i18n";
import ConsentForm from "@/components/ConsentForm";

export default function ConsentPreviewFrame({
  type,
  versionLabel,
  versionNumber,
  status,
  editHref,
}: {
  type: "pilot" | "main";
  versionLabel: string;
  versionNumber: number;
  status: string;
  editHref: string;
}) {
  const [lang, setLang] = useState<Lang>("en");

  return (
    <div className="min-h-screen bg-bgAlt" dir="ltr">
      {/* ADMIN preview frame (always LTR; not part of the respondent view). */}
      <div className="bg-ink text-white">
        <div className="max-w-3xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="chip-solid bg-warn text-white">PREVIEW</span>
            <span className="font-semibold">
              {versionLabel} · v{versionNumber}
            </span>
            <span className="text-white/60 capitalize">({status})</span>
            <span className="text-white/70">
              — {type} consent · nothing is saved · Sign is inert
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* EN/AR toggle — LOCAL state only (no cookie, no refresh). */}
            <div className="flex items-center rounded-md overflow-hidden border border-white/25 font-semibold">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2 py-1 transition-colors ${
                  lang === "en" ? "bg-white text-ink" : "text-white/80 hover:text-white"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("ar")}
                className={`px-2 py-1 font-arabic transition-colors ${
                  lang === "ar" ? "bg-white text-ink" : "text-white/80 hover:text-white"
                }`}
              >
                ع
              </button>
            </div>
            <Link href={editHref} className="text-white/80 hover:text-white underline">
              Back to editor
            </Link>
          </div>
        </div>
      </div>

      {/* The real ConsentForm, in preview mode (Sign inert). */}
      <ConsentForm lang={lang} type={type} preview />
    </div>
  );
}
