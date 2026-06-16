"use client";

// components/QuestionnaireWizard.tsx
//
// One-question-per-page wizard (D46). Receives the already-filtered,
// ordered visible question set (Edge 3) + existing answers + the
// server-derived start index (Edge 2) + the display language.
//
// Autosave + navigation (Edge 1): every boundary — Next, Back, jumpTo,
// language switch, submit — awaits flushSave() before acting, so no
// edit is lost. flushSave(idx) takes an explicit index so a late
// debounce timer saves the question it was typed in, not wherever the
// user has since navigated.
//
// Language switch (Edge 1.5): flushSave() → setLangAction() →
// router.refresh(). This relies on router.refresh() being a SOFT
// refresh that preserves this component's state (currentIdx +
// textarea; no remount). If Next.js ever changes that, currentIdx
// must be re-derived from initialAnswers on every refresh instead.
//
// The question map iterates ONLY the filtered `questions` array — a
// Jordanian's map has no Q10–Q13 cells (absent, not disabled), so the
// existence of Syria-only questions never leaks.

import { useState, useRef, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// D68 — `pilotBadgeLabel` + `PilotCategory` import dropped along with the
// header badge. The parent page no longer passes `category` either.
import { getTranslations, type Lang } from "@/lib/i18n";
import {
  saveAnswer,
  saveChoiceAnswer,
  submitQuestionnaire,
} from "@/lib/actions/answers";
import { setLangAction } from "@/lib/actions/setLang";

type AnswerType = "free_text" | "single_choice" | "multi_choice";

export type WizardOption = { id: string; labelEn: string; labelAr: string };

export type WizardQuestion = {
  id: string;
  code: string;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  // D103 — choice questions carry their type, flags, and options. free_text
  // questions keep answerType 'free_text' with no options; their path below
  // is unchanged.
  answerType: AnswerType;
  allowComment: boolean;
  allowSkip: boolean;
  options: WizardOption[];
};

// Stable string form of a choice answer (sorted ids + comment) for the
// save-dedup ref — the choice analogue of comparing the free_text string.
function serializeChoice(ids: string[], comment: string): string {
  return [...ids].sort().join(",") + "|" + comment;
}

export default function QuestionnaireWizard({
  questions,
  initialAnswers,
  initialSelections,
  initialComments,
  initialIdx,
  lang,
}: {
  questions: WizardQuestion[];
  initialAnswers: Record<string, string>;
  initialSelections: Record<string, string[]>;
  initialComments: Record<string, string>;
  initialIdx: number;
  lang: Lang;
}) {
  const t = getTranslations(lang);
  const isAr = lang === "ar";
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  // D103 — choice state, parallel to `answers` (the free_text string map).
  const [selections, setSelections] =
    useState<Record<string, string[]>>(initialSelections);
  const [comments, setComments] =
    useState<Record<string, string>>(initialComments);
  const [currentIdx, setCurrentIdx] = useState(
    Math.min(Math.max(initialIdx, 0), Math.max(questions.length - 1, 0))
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [showRequiredHint, setShowRequiredHint] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Refs avoid stale closures across awaits.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const lastSavedRef = useRef<Record<string, string>>({ ...initialAnswers });
  // Dedup for choice saves: serialized (sorted ids + comment) per question.
  const lastSavedChoiceRef = useRef<Record<string, string>>(
    Object.fromEntries(
      questions
        .filter((q) => q.answerType !== "free_text")
        .map((q) => [
          q.id,
          serializeChoice(
            initialSelections[q.id] ?? [],
            initialComments[q.id] ?? ""
          ),
        ])
    )
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef = useRef(currentIdx);
  idxRef.current = currentIdx;
  const cardRef = useRef<HTMLDivElement>(null);

  const current = questions[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === questions.length - 1;
  const progress = ((currentIdx + 1) / questions.length) * 100;

  // D103 — type-aware "has an answer" (actually filled): free_text → text
  // non-empty (the pre-D103 rule, unchanged); choice → >=1 selection.
  function qHasAnswer(q: WizardQuestion): boolean {
    if (q.answerType === "free_text") {
      return (answers[q.id] ?? "").trim().length > 0;
    }
    return (selections[q.id]?.length ?? 0) > 0;
  }
  // "Satisfied" for forward-progress/submit: answered OR skippable. A
  // free_text question (allowSkip always false) reduces this to qHasAnswer —
  // identical to the old behavior.
  function qSatisfied(q: WizardQuestion): boolean {
    return q.allowSkip || qHasAnswer(q);
  }

  const isChoice = current.answerType !== "free_text";
  const answeredCount = questions.filter(qHasAnswer).length;

  const currentText = answers[current.id] ?? ""; // free_text only
  const currentSelection = selections[current.id] ?? []; // choice only
  const currentComment = comments[current.id] ?? ""; // choice only
  const currentHasAnswer = qHasAnswer(current);
  const currentSatisfied = qSatisfied(current);
  // Alias so the free_text textarea block stays byte-identical to pre-D103
  // (free_text: hasAnswer === the old "non-empty text" notion).
  const currentIsAnswered = currentHasAnswer;
  const wordCount = currentText.trim()
    ? currentText.trim().split(/\s+/).length
    : 0;

  // furthestReachable over the FILTERED set (Edge 3 / D12 forward-lock).
  // Type-aware: a skippable question never blocks progress; a choice question
  // is reachable-past once it has a selection.
  const furthestReachable = useMemo(() => {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const has =
        q.answerType === "free_text"
          ? (answers[q.id] ?? "").trim().length > 0
          : (selections[q.id]?.length ?? 0) > 0;
      if (!(q.allowSkip || has)) return i;
    }
    return questions.length - 1;
  }, [answers, selections, questions]);

  const showFeedbackIntro =
    current.isFeedback &&
    (currentIdx === 0 || !questions[currentIdx - 1].isFeedback);

  // Persist the question at `idx` if its text changed since last save.
  // Cancels any pending debounce. Awaited at every navigation boundary.
  async function flushSave(idx = idxRef.current) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const id = questions[idx].id;
    const text = answersRef.current[id] ?? "";
    if (text === (lastSavedRef.current[id] ?? "")) return; // nothing to save
    setSaveState("saving");
    const res = await saveAnswer(id, text);
    if (res.ok) {
      lastSavedRef.current[id] = text;
      setSaveState("saved");
    } else {
      setSaveState("idle"); // failed → retried at the next boundary
    }
  }

  function onType(text: string) {
    setAnswers((a) => ({ ...a, [current.id]: text }));
    if (showRequiredHint && text.trim().length > 0) setShowRequiredHint(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const idxAtType = idxRef.current; // capture so a late timer saves the right Q
    debounceRef.current = setTimeout(() => void flushSave(idxAtType), 600);
  }

  // D103 — choice save (selections + optional comment) via save_choice_answer.
  // Mirrors flushSave's dedup/save-state shape but over the serialized choice.
  async function flushChoiceSave(idx = idxRef.current) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const q = questions[idx];
    if (q.answerType === "free_text") return;
    const ids = selectionsRef.current[q.id] ?? [];
    const comment = commentsRef.current[q.id] ?? "";
    const key = serializeChoice(ids, comment);
    if (key === (lastSavedChoiceRef.current[q.id] ?? serializeChoice([], ""))) {
      return; // nothing changed since last save
    }
    setSaveState("saving");
    const res = await saveChoiceAnswer(
      q.id,
      ids,
      comment.trim().length > 0 ? comment : null
    );
    if (res.ok) {
      lastSavedChoiceRef.current[q.id] = key;
      setSaveState("saved");
    } else {
      setSaveState("idle"); // failed → retried at the next boundary
    }
  }

  // Boundary flush dispatcher: routes to the free_text or choice saver by
  // question type. free_text boundary saves go through flushSave unchanged.
  async function flushBoundary(idx = idxRef.current) {
    if (questions[idx].answerType === "free_text") return flushSave(idx);
    return flushChoiceSave(idx);
  }

  // Radio: replace the selection with exactly one option; save immediately
  // (no debounce — a click is a deliberate, complete act). Update the ref
  // synchronously so the save reads the new value.
  function onSelectSingle(optionId: string) {
    const next = { ...selectionsRef.current, [current.id]: [optionId] };
    selectionsRef.current = next;
    setSelections(next);
    if (showRequiredHint) setShowRequiredHint(false);
    void flushChoiceSave(idxRef.current);
  }

  // Checkbox: toggle the option in/out of the set; save immediately.
  function onToggleMulti(optionId: string) {
    const cur = selectionsRef.current[current.id] ?? [];
    const nextArr = cur.includes(optionId)
      ? cur.filter((x) => x !== optionId)
      : [...cur, optionId];
    const next = { ...selectionsRef.current, [current.id]: nextArr };
    selectionsRef.current = next;
    setSelections(next);
    if (showRequiredHint && nextArr.length > 0) setShowRequiredHint(false);
    void flushChoiceSave(idxRef.current);
  }

  // Optional comment: debounced like the free_text textarea (600ms).
  function onCommentType(text: string) {
    const next = { ...commentsRef.current, [current.id]: text };
    commentsRef.current = next;
    setComments(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const idxAtType = idxRef.current;
    debounceRef.current = setTimeout(() => void flushChoiceSave(idxAtType), 600);
  }

  function triggerShake() {
    setShowRequiredHint(true);
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth; // reflow so the animation re-fires
    el.classList.add("shake");
  }

  async function handleNext() {
    if (!currentSatisfied) {
      triggerShake();
      return;
    }
    await flushBoundary();
    if (isLast) {
      void handleSubmit();
      return;
    }
    setCurrentIdx((i) => i + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handlePrev() {
    if (isFirst) return;
    await flushBoundary(); // Back flushes too (no required gate)
    setCurrentIdx((i) => i - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function jumpTo(i: number) {
    if (i > furthestReachable || i === currentIdx) return; // forward-lock (D12)
    await flushBoundary();
    setCurrentIdx(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleLangSwitch(next: Lang) {
    if (next === lang || pending) return;
    // Edge 1.5: flush BEFORE the refresh, and OUTSIDE the transition so
    // the save round-trip fully settles (its saveState indicator updates
    // at normal priority) before the refresh machinery engages. Contrast
    // handleSubmit, which flushes inside its transition — that's fine
    // there because it redirects away, so the indicator is never seen;
    // here we stay on-page after router.refresh(), so the indicator
    // matters. The brief pre-transition window where the toggle isn't
    // `pending`-disabled is a negligible race (flush is fast; the upsert
    // is idempotent).
    await flushBoundary();
    startTransition(async () => {
      await setLangAction(next);
      router.refresh();
    });
  }

  function handleSubmit() {
    setMissing([]);
    startTransition(async () => {
      await flushBoundary();
      const res = await submitQuestionnaire(); // redirects on success
      if (res && !res.ok) {
        setMissing(res.missing); // names the blank questions
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  // Save & Exit explicitly promises a save — flush the pending edit
  // before leaving so no keystrokes in the debounce window are lost.
  async function handleSaveExit() {
    await flushBoundary();
    router.push("/");
  }

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className={`min-h-screen bg-white ${isAr ? "font-arabic" : ""}`}
    >
      <header className="border-b border-line bg-white/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-[13px] font-bold text-ink tracking-tight"
          >
            {t.studyLabel}
          </Link>
          <div className="flex items-center gap-4">
            <SaveIndicator state={saveState} t={t} />
            {/* D68 — pilot badge removed; header reads study label + save
                indicator + language toggle only. Version tracking is
                backend-only via questionnaire_version_id. */}
            <LangToggle lang={lang} pending={pending} onSwitch={handleLangSwitch} />
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
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="eyebrow mb-1">
              {current.isFeedback ? t.feedbackSection : t.questionnaire}
            </div>
            <div className="text-[15px] text-muted">
              {t.question}{" "}
              <span className="font-semibold text-ink">{currentIdx + 1}</span>{" "}
              {t.of}{" "}
              <span className="font-semibold text-ink">{questions.length}</span>
            </div>
          </div>
          <div className="text-[13px] text-muted">
            <span className="font-semibold text-ink">{answeredCount}</span> /{" "}
            {questions.length} {t.answeredCountLabel}
          </div>
        </div>

        {missing.length > 0 && (
          <div className="notice-warn mb-6">
            <div>
              <strong>{t.submitMissingTitle}</strong>{" "}
              <span className="mono">{missing.join(", ")}</span>
            </div>
          </div>
        )}

        {showFeedbackIntro && (
          <div className="notice-info mb-6">
            <div>
              <div className="font-semibold mb-0.5">{t.feedbackSection}</div>
              <div>{t.feedbackIntro}</div>
            </div>
          </div>
        )}

        <div ref={cardRef} className="card-elevated p-7 mb-4">
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

          <h2
            id="current-question-text"
            className="text-[20px] font-semibold leading-[1.4] text-ink mb-5"
          >
            {isAr ? current.textAr : current.textEn}
          </h2>

          {!isChoice ? (
            <>
              <textarea
                className={`field ${
                  showRequiredHint && !currentIsAnswered
                    ? "!border-danger !shadow-[0_0_0_3px_rgba(220,38,38,0.15)]"
                    : ""
                }`}
                aria-labelledby="current-question-text"
                placeholder={t.writeAnswer}
                value={currentText}
                onChange={(e) => onType(e.target.value)}
                rows={9}
                autoFocus
              />

              <div className="flex items-center justify-between mt-2 text-[12px] text-muted">
                <span>
                  {wordCount} {wordCount === 1 ? t.wordOne : t.wordMany}
                </span>
                {currentIsAnswered ? (
                  <span className="flex items-center gap-1 text-accent-700">
                    {t.answeredStatus}
                  </span>
                ) : (
                  <span>{t.writeBeforeContinuing}</span>
                )}
              </div>

              {showRequiredHint && !currentIsAnswered && (
                <div className="notice-warn mt-4">
                  <div>
                    <strong>{t.requiredHintTitle}</strong> {t.requiredHintBody}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] text-muted mb-3">
                {current.answerType === "single_choice"
                  ? t.chooseOne
                  : t.chooseMultiple}
              </div>

              <div
                className="space-y-2"
                role={
                  current.answerType === "single_choice" ? "radiogroup" : "group"
                }
                aria-labelledby="current-question-text"
              >
                {current.options.map((o) => {
                  const checked = currentSelection.includes(o.id);
                  const isRadio = current.answerType === "single_choice";
                  return (
                    <label
                      key={o.id}
                      className={`flex items-center gap-3 card p-3.5 cursor-pointer transition-colors ${
                        checked
                          ? "ring-2 ring-brand-500 bg-brand-50/40"
                          : "hover:border-ink"
                      }`}
                    >
                      <input
                        type={isRadio ? "radio" : "checkbox"}
                        name={isRadio ? `q-${current.id}` : undefined}
                        checked={checked}
                        onChange={() =>
                          isRadio ? onSelectSingle(o.id) : onToggleMulti(o.id)
                        }
                        className="accent-brand-600 shrink-0"
                      />
                      <span className="text-[15px] text-ink">
                        {isAr ? o.labelAr : o.labelEn}
                      </span>
                    </label>
                  );
                })}
              </div>

              {current.allowComment && (
                <div className="mt-4">
                  <label className="label" htmlFor="choice-comment">
                    {t.optionalComment}
                  </label>
                  <textarea
                    id="choice-comment"
                    className="field"
                    placeholder={t.commentPlaceholder}
                    value={currentComment}
                    onChange={(e) => onCommentType(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              <div className="flex items-center justify-between mt-3 text-[12px] text-muted">
                <span>
                  {currentSelection.length} {t.selectedCountLabel}
                </span>
                {currentHasAnswer ? (
                  <span className="flex items-center gap-1 text-accent-700">
                    {t.answeredStatus}
                  </span>
                ) : current.allowSkip ? (
                  <span>{t.maySkip}</span>
                ) : (
                  <span>{t.selectBeforeContinuing}</span>
                )}
              </div>

              {showRequiredHint && !currentSatisfied && (
                <div className="notice-warn mt-4">
                  <div>
                    <strong>{t.requiredHintTitle}</strong>{" "}
                    {t.selectBeforeContinuing}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 mt-6">
          <button
            onClick={handlePrev}
            disabled={isFirst || pending}
            className="btn-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="rtl:rotate-180">←</span> {t.previous}
          </button>

          <button
            type="button"
            onClick={() => void handleSaveExit()}
            disabled={pending}
            className="btn-ghost text-[12px]"
          >
            {t.saveAndExit}
          </button>

          <button
            onClick={handleNext}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!currentSatisfied || pending}
          >
            {isLast ? t.submit : t.next} <span className="rtl:rotate-180">→</span>
          </button>
        </div>

        <div className="mt-14 pt-8 border-t border-line">
          <div className="flex items-center justify-between mb-4">
            <div className="label !mb-0">{t.questionMap}</div>
            <div className="flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-brand-600" />{" "}
                {t.mapLegendAnswered}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-ink" /> {t.mapLegendCurrent}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-line" /> {t.mapLegendLocked}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((q, i) => {
              const isAnswered = qHasAnswer(q);
              const isCurrent = i === currentIdx;
              const isLocked = i > furthestReachable;
              return (
                <button
                  key={q.id}
                  onClick={() => jumpTo(i)}
                  disabled={isLocked || pending}
                  title={isLocked ? t.completePrevFirst : q.code}
                  className={`mono text-[11px] font-semibold min-w-[40px] h-8 px-2 transition-all ${
                    q.isFeedback ? "rounded-full" : "rounded-md"
                  } ${
                    isCurrent
                      ? "bg-ink text-white"
                      : isAnswered
                      ? "bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
                      : isLocked
                      ? "bg-bgAlt text-muted-faint border border-line cursor-not-allowed"
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
      </div>
    </main>
  );
}

function SaveIndicator({
  state,
  t,
}: {
  state: "idle" | "saving" | "saved";
  t: ReturnType<typeof getTranslations>;
}) {
  if (state === "idle") return null;
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-muted">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          state === "saving" ? "bg-warn animate-pulse" : "bg-accent-600"
        }`}
      />
      {state === "saving" ? t.saving : t.saved}
    </div>
  );
}

// Compact in-wizard language toggle. Self-named labels (not translated).
// Wired to handleLangSwitch which flushes the pending save before the
// cookie write + router.refresh() (Edge 1.5).
function LangToggle({
  lang,
  pending,
  onSwitch,
}: {
  lang: Lang;
  pending: boolean;
  onSwitch: (next: Lang) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-line overflow-hidden text-[12px] font-semibold">
      <button
        type="button"
        onClick={() => onSwitch("en")}
        disabled={pending}
        className={`px-2 py-1 transition-colors ${
          lang === "en" ? "bg-brand-600 text-white" : "bg-white text-muted hover:text-ink"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => onSwitch("ar")}
        disabled={pending}
        className={`px-2 py-1 font-arabic transition-colors ${
          lang === "ar" ? "bg-brand-600 text-white" : "bg-white text-muted hover:text-ink"
        }`}
      >
        ع
      </button>
    </div>
  );
}
