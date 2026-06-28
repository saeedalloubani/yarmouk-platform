"use client";

// components/ConsentForm.tsx
//
// Consent form (client). Ports the mock's app/consent/page.tsx:
// 3 read-only info sections + a REQUIRED audio radio (no default
// selection — forces a conscious choice) + 2 required checkboxes +
// name. The client gate is UX only; submitConsent re-validates
// everything server-side and encrypts the name in the DB (D36/D47).
//
// Strings come from getTranslations(lang). dir/font-arabic flip with
// the resolved language.

import { useState, useTransition } from "react";
import Link from "next/link";
import { getTranslations, type Lang } from "@/lib/i18n";
import { submitConsent } from "@/lib/actions/consent";

export default function ConsentForm({
  lang,
  type,
  preview = false,
}: {
  lang: Lang;
  type: "pilot" | "main";
  // D105a — owner preview: render + let the boxes/radio toggle (so Sign
  // visibly enables), but the Sign button is INERT — no submitConsent, no
  // write. Defaults false, so the real respondent flow is unchanged.
  preview?: boolean;
}) {
  const t = getTranslations(lang);
  const isAr = lang === "ar";

  const [agreeRead, setAgreeRead] = useState(false);
  const [agreeParticipate, setAgreeParticipate] = useState(false);
  const [audioChoice, setAudioChoice] = useState<"audio" | "noaudio" | null>(
    null
  );
  // D105 — MAIN-only declarations 2 (voluntary) + 4 (confidentiality): required
  // UI gates, NOT stored (Option A — no new columns). Unused on the pilot path.
  const [agreeVoluntary, setAgreeVoluntary] = useState(false);
  const [agreeConfidential, setAgreeConfidential] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const today = new Date().toLocaleDateString(isAr ? "ar-JO" : "en-GB");

  // Pilot gate is unchanged. Main additionally requires the two new
  // declaration checkboxes; audioChoice !== null = a conscious agree/decline
  // (either value proceeds — declining audio still consents).
  const canSubmit =
    type === "main"
      ? agreeRead &&
        agreeVoluntary &&
        agreeConfidential &&
        agreeParticipate &&
        audioChoice !== null &&
        name.trim().length > 0
      : agreeRead &&
        agreeParticipate &&
        audioChoice !== null &&
        name.trim().length > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return; // D105a — owner preview: Sign is INERT; no submit, no write
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await submitConsent({
        agreedToRead: agreeRead,
        agreedToParticipate: agreeParticipate,
        audioChoice,
        name,
      });
      // Success redirects server-side; only failures return here.
      if (res && !res.ok) setError(t.consentError);
    });
  }

  // D105 — MAIN consent (Sura's approved JUST/WDC IRB form). Identity blocks +
  // 5 info sections + the 5-declaration block (1,2,4,5 required checkboxes; 3 is
  // the audio agree/decline radio — declining still consents). The pilot render
  // below is byte-identical to pre-D105.
  if (type === "main") {
    return (
      <main
        dir={isAr ? "rtl" : "ltr"}
        className={`min-h-screen bg-white ${isAr ? "font-arabic" : ""}`}
      >
        <header className="border-b border-line">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-[14px] font-bold text-ink tracking-tight">
              {t.studyLabel}
            </Link>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {t.step1of3}
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-6 pt-12 pb-20">
          <div className="eyebrow mb-3">{t.consent}</div>
          <h1 className="text-[28px] font-bold text-ink leading-tight mb-3 tracking-tight">
            {t.mcTitle}
          </h1>
          <p className="text-[15px] text-muted-strong leading-relaxed mb-6">
            {t.mcResearchTitle}
          </p>

          {/* Identity block — self-describing values (researcher / institution
              / supervisor / co-advisor). */}
          <div className="card p-5 mb-8 space-y-1.5 text-[13px] text-ink">
            <div>{t.mcResearcher}</div>
            <div>{t.mcInstitution}</div>
            <div>{t.mcSupervisor}</div>
            <div>{t.mcCoAdvisor}</div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <Section index="1" title={t.mcPurposeTitle} body={t.mcPurposeText} />
            <Section
              index="2"
              title={t.mcParticipationTitle}
              body={t.mcParticipationText}
            />
            <Section
              index="3"
              title={t.mcRecordingTitle}
              body={t.mcRecordingText}
            />
            <Section
              index="4"
              title={t.mcConfidentialityTitle}
              body={t.mcConfidentialityText}
            />
            <Section
              index="5"
              title={t.mcContactTitle}
              body={t.mcContactText}
            />

            {/* Consent declaration — 5 items in form order. 1,2,4,5 are required
                checkboxes; 3 is the audio agree/decline radio (optional —
                declining audio still consents + participates). */}
            <div className="card p-6">
              <p className="text-[15px] font-bold text-ink mb-4">
                {t.mcDeclHeading}
              </p>
              <div className="space-y-3">
                <CheckOption
                  checked={agreeRead}
                  onChange={setAgreeRead}
                  label={t.mcDecl1}
                />
                <CheckOption
                  checked={agreeVoluntary}
                  onChange={setAgreeVoluntary}
                  label={t.mcDecl2}
                />
                {/* 3 — audio recording: explicit agree/decline radio */}
                <div className="space-y-2.5 py-1">
                  <RadioOption
                    checked={audioChoice === "audio"}
                    onChange={() => setAudioChoice("audio")}
                    label={t.mcDecl3}
                  />
                  <RadioOption
                    checked={audioChoice === "noaudio"}
                    onChange={() => setAudioChoice("noaudio")}
                    label={t.audioDecline}
                  />
                </div>
                <CheckOption
                  checked={agreeConfidential}
                  onChange={setAgreeConfidential}
                  label={t.mcDecl4}
                />
                <CheckOption
                  checked={agreeParticipate}
                  onChange={setAgreeParticipate}
                  label={t.mcDecl5}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 mt-2 border-t border-line">
                <div>
                  <label className="label">{t.mcSignatureLabel}</label>
                  <input
                    type="text"
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.fullNamePlaceholder}
                  />
                </div>
                <div>
                  <label className="label">{t.todayDate}</label>
                  <input type="text" className="field" value={today} disabled />
                </div>
              </div>
            </div>

            {error && (
              <div className="notice-warn">
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 pt-2">
              <Link href="/" className="btn-secondary">
                <span className="rtl:rotate-180">←</span> {t.back}
              </Link>
              <button
                type="submit"
                disabled={!canSubmit || pending}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.signAndContinue}
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
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className={`min-h-screen bg-white ${isAr ? "font-arabic" : ""}`}
    >
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-[14px] font-bold text-ink tracking-tight">
            {t.studyLabel}
          </Link>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t.step1of3}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="eyebrow mb-3">{t.consent}</div>
        <h1 className="text-[32px] font-bold text-ink leading-tight mb-3 tracking-tight">
          {t.consent}
        </h1>
        <p className="text-[15px] text-muted-strong leading-relaxed mb-10">
          {t.consentRead}
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          <Section index="1" title={t.purpose} body={t.purposeText} />
          <Section index="2" title={t.whatWeAsk} body={t.whatWeAskText} />
          <Section
            index="3"
            title={t.confidentiality}
            body={t.confidentialityText}
          />

          {/* 4 — Audio recording: REQUIRED radio, no pre-selection */}
          <div className="card p-6">
            <SectionHeader index="4" title={t.audioSectionTitle} />
            <p className="text-[14px] text-muted-strong leading-relaxed mb-4">
              {t.audioSectionBody}
            </p>
            <div className="space-y-2.5">
              <RadioOption
                checked={audioChoice === "audio"}
                onChange={() => setAudioChoice("audio")}
                label={t.audioAgree}
              />
              <RadioOption
                checked={audioChoice === "noaudio"}
                onChange={() => setAudioChoice("noaudio")}
                label={t.audioDecline}
              />
            </div>
          </div>

          {/* 5 — Confirmations + name */}
          <div className="card p-6">
            <SectionHeader index="5" title={t.iConfirm} />
            <div className="space-y-3 mb-6">
              <CheckOption
                checked={agreeRead}
                onChange={setAgreeRead}
                label={t.agreeRead}
              />
              <CheckOption
                checked={agreeParticipate}
                onChange={setAgreeParticipate}
                label={t.agreeParticipate}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-line">
              <div>
                <label className="label">{t.fullName}</label>
                <input
                  type="text"
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.fullNamePlaceholder}
                />
              </div>
              <div>
                <label className="label">{t.todayDate}</label>
                <input type="text" className="field" value={today} disabled />
              </div>
            </div>
          </div>

          {error && (
            <div className="notice-warn">
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2">
            <Link href="/" className="btn-secondary">
              <span className="rtl:rotate-180">←</span> {t.back}
            </Link>
            <button
              type="submit"
              disabled={!canSubmit || pending}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.signAndContinue}
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
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function Section({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card p-6">
      <SectionHeader index={index} title={title} />
      <p className="text-[14px] text-muted-strong leading-[1.7]">{body}</p>
    </div>
  );
}

function SectionHeader({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[12px] font-bold flex items-center justify-center">
        {index}
      </span>
      <h2 className="text-[17px] font-bold text-ink">{title}</h2>
    </div>
  );
}

function CheckOption({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <span
        className={`relative mt-0.5 inline-block w-[18px] h-[18px] rounded border-2 transition-colors flex-shrink-0 ${
          checked
            ? "bg-brand-600 border-brand-600"
            : "bg-white border-lineStrong group-hover:border-brand-600"
        }`}
      >
        {checked && (
          <svg
            className="absolute inset-0 m-auto"
            width="11"
            height="11"
            viewBox="0 0 12 12"
          >
            <path
              d="M 2 6 L 5 9 L 10 3"
              stroke="#ffffff"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-[14px] text-ink leading-snug">{label}</span>
    </label>
  );
}

function RadioOption({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <span
        className={`relative mt-0.5 inline-block w-[18px] h-[18px] rounded-full border-2 transition-colors flex-shrink-0 ${
          checked
            ? "border-brand-600"
            : "border-lineStrong group-hover:border-brand-600"
        }`}
      >
        {checked && (
          <span className="absolute inset-1 rounded-full bg-brand-600" />
        )}
      </span>
      <input
        type="radio"
        className="sr-only"
        checked={checked}
        onChange={onChange}
      />
      <span className="text-[14px] text-ink leading-snug">{label}</span>
    </label>
  );
}
