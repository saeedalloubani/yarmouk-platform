"use client";

// components/QuestionnairePreview.tsx
//
// OWNER-ONLY, READ-ONLY preview of a questionnaire variant — proofing tool for
// the draft pilots. It mirrors the live QuestionnaireWizard's VISUAL shell
// (header/progress/card-elevated/code+required chips/EN-AR/dir+font-arabic/
// feedback-section intro/question-map) but is a SEPARATE component that WRITES
// NOTHING — it performs no autosave, no submit, no language-cookie write, and no
// soft refresh; no session, consent, or response is imported or referenced. (The
// write-action and DB-client identifiers appear nowhere in this file — so the
// no-writes grep is a clean true-negative, not a comment false-positive.)
// The live wizard couples navigation to autosave + advancing to answering;
// reusing it for a preview would mean invasive surgery on the data-collection
// path. This duplicates some markup instead, on purpose.
//
// Differences from the respondent experience (intentional, it's proofing):
//   - Free navigation: Prev/Next/jumpTo all unlocked (no required-gate, no
//     forward-lock) — proofing, not answering.
//   - The answer textarea is DISABLED (layout matches the respondent view;
//     nothing is typable or savable).
//   - EN/AR toggle is LOCAL state (no cookie, no refresh).
//   - Jordanian/Syrian toggle re-filters by visible_nationalities (NULL =
//     everyone OR nationality ∈ array) — shown only when the variant has gated
//     questions (officials). Default Jordanian; switch to Syrian to reveal Q10.

import { useMemo, useState } from "react";
import Link from "next/link";
import { getTranslations, type Lang } from "@/lib/i18n";

export type PreviewQuestion = {
  id: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isRequired: boolean;
  isFeedback: boolean;
  visibleNationalities: string[] | null;
};

type Nat = "jordanian" | "syrian";

function isVisibleTo(q: PreviewQuestion, nat: Nat): boolean {
  return (
    q.visibleNationalities == null ||
    q.visibleNationalities.length === 0 ||
    q.visibleNationalities.includes(nat)
  );
}

export default function QuestionnairePreview({
  versionLabel,
  versionNumber,
  status,
  questions,
  hasGated,
  editHref,
}: {
  versionLabel: string;
  versionNumber: number;
  status: string;
  questions: PreviewQuestion[];
  hasGated: boolean;
  editHref: string;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const [nationality, setNationality] = useState<Nat>("jordanian");
  const [currentIdx, setCurrentIdx] = useState(0);

  const t = getTranslations(lang);
  const isAr = lang === "ar";

  // Filtered, ordered visible set for the chosen nationality (mirrors
  // getVisibleQuestions' predicate). For non-gated variants every question
  // passes regardless of the toggle.
  const visible = useMemo(
    () =>
      questions
        .filter((q) => isVisibleTo(q, nationality))
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [questions, nationality]
  );

  // Clamp the cursor whenever the visible set shrinks (e.g. Jordanian hides Q10).
  const idx = Math.min(currentIdx, Math.max(visible.length - 1, 0));
  const current = visible[idx];

  const isFirst = idx === 0;
  const isLast = idx === visible.length - 1;
  const progress = visible.length > 0 ? ((idx + 1) / visible.length) * 100 : 0;

  const showFeedbackIntro =
    current?.isFeedback && (idx === 0 || !visible[idx - 1]?.isFeedback);

  function go(i: number) {
    setCurrentIdx(Math.min(Math.max(i, 0), Math.max(visible.length - 1, 0)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
            <span className="text-white/70">— nothing is saved</span>
          </div>
          <div className="flex items-center gap-3">
            {hasGated && (
              <div className="flex items-center gap-1.5">
                <span className="text-white/70">Viewing as:</span>
                <div className="flex items-center rounded-md overflow-hidden border border-white/25 font-semibold">
                  {(["jordanian", "syrian"] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNationality(n)}
                      className={`px-2 py-1 capitalize transition-colors ${
                        nationality === n
                          ? "bg-white text-ink"
                          : "text-white/80 hover:text-white"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Link href={editHref} className="text-white/80 hover:text-white underline">
              Back to editor
            </Link>
          </div>
        </div>
      </div>

      {/* Faithful respondent shell (dir + font follow the previewed language). */}
      <main className={`bg-white ${isAr ? "font-arabic" : ""}`} dir={isAr ? "rtl" : "ltr"}>
        <header className="border-b border-line bg-white/95 backdrop-blur sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <span className="text-[13px] font-bold text-ink tracking-tight">
              {t.studyLabel}
            </span>
            <div className="flex items-center gap-4">
              <span className="chip-solid bg-brand-50 text-brand-700 hidden sm:inline-flex">
                {t.pilotBadge}
              </span>
              {/* EN/AR toggle — LOCAL state only (no cookie, no refresh). */}
              <div className="flex items-center rounded-md border border-line overflow-hidden text-[12px] font-semibold">
                <button
                  type="button"
                  onClick={() => setLang("en")}
                  className={`px-2 py-1 transition-colors ${
                    lang === "en" ? "bg-brand-600 text-white" : "bg-white text-muted hover:text-ink"
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLang("ar")}
                  className={`px-2 py-1 font-arabic transition-colors ${
                    lang === "ar" ? "bg-brand-600 text-white" : "bg-white text-muted hover:text-ink"
                  }`}
                >
                  ع
                </button>
              </div>
            </div>
          </div>
          <div className="h-1 bg-bgAlt">
            <div
              className="h-full bg-brand-600 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </header>

        <div className="max-w-3xl mx-auto px-6 pt-10 pb-32">
          {visible.length === 0 ? (
            <div className="card p-8 text-center text-[14px] text-muted">
              No questions in this variant yet.
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between mb-6">
                <div>
                  <div className="eyebrow mb-1">
                    {current.isFeedback ? t.feedbackSection : t.questionnaire}
                  </div>
                  <div className="text-[15px] text-muted">
                    {t.question}{" "}
                    <span className="font-semibold text-ink">{idx + 1}</span> {t.of}{" "}
                    <span className="font-semibold text-ink">{visible.length}</span>
                  </div>
                </div>
              </div>

              {showFeedbackIntro && (
                <div className="notice-info mb-6">
                  <div>
                    <div className="font-semibold mb-0.5">{t.feedbackSection}</div>
                    <div>{t.feedbackIntro}</div>
                  </div>
                </div>
              )}

              <div className="card-elevated p-7 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className="mono text-[12px] font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">
                    {current.code}
                  </span>
                  {current.isRequired && (
                    <span className="text-[12px] text-danger font-semibold">
                      {t.requiredMark}
                    </span>
                  )}
                </div>

                <h2 className="text-[20px] font-semibold leading-[1.4] text-ink mb-5">
                  {isAr ? current.textAr : current.textEn}
                </h2>

                <textarea
                  className="field opacity-60 cursor-not-allowed"
                  placeholder={t.writeAnswer}
                  rows={9}
                  disabled
                  readOnly
                />
                <div className="text-[12px] text-muted mt-2">
                  {isAr
                    ? "معاينة فقط — حقل الإجابة معطّل"
                    : "Preview only — the answer field is disabled"}
                </div>
              </div>

              {/* Free navigation — no required-gate, no forward-lock. */}
              <div className="flex items-center justify-between gap-4 mt-6">
                <button
                  onClick={() => go(idx - 1)}
                  disabled={isFirst}
                  className="btn-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <span className="rtl:rotate-180">←</span> {t.previous}
                </button>
                <button
                  onClick={() => go(idx + 1)}
                  disabled={isLast}
                  className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t.next} <span className="rtl:rotate-180">→</span>
                </button>
              </div>

              {/* Question map — every cell reachable (free nav). */}
              <div className="mt-14 pt-8 border-t border-line">
                <div className="label !mb-3">{t.questionMap}</div>
                <div className="flex flex-wrap gap-1.5">
                  {visible.map((q, i) => {
                    const isCurrent = i === idx;
                    return (
                      <button
                        key={q.id}
                        onClick={() => go(i)}
                        title={q.code}
                        className={`mono text-[11px] font-semibold min-w-[40px] h-8 px-2 transition-all ${
                          q.isFeedback ? "rounded-full" : "rounded-md"
                        } ${
                          isCurrent
                            ? "bg-ink text-white"
                            : "bg-white text-muted border border-line hover:border-ink hover:text-ink"
                        }`}
                      >
                        {q.code}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-faint mt-3">{t.mapHint}</div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
