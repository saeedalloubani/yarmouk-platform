"use client";

// components/ExportModal.tsx
//
// D84 — Unified export modal. Replaces the inline Single + Bulk forms
// on /admin/exports/page.tsx with one trigger button → modal.
//
// THREE LOCKED CONSTRAINTS encoded here (D84 Q-D, Q-E, Q-J):
//   1. shape=wide is single-variant: when wide is selected and scope is
//      bulk, the category control flips from multi-select checkboxes
//      to single-select radios. The Download button disables if 0 or
//      >1 categories are selected. (Backend defends with
//      AtlasMultiVariantError.)
//   2. shape=long supports unconstrained multi-category. Long is the
//      D74 path; behavior preserved.
//   3. wide is the default radio selection (D84 Q-I — new feature
//      spotlight). xlsx default format (matches ATLAS.ti's preferred
//      input).
//
// PII is never displayed in the modal — only ref_codes + categories
// + submitted_at strings, all of which are public-identifier-grade
// non-PII. The decrypted name/email surfaces only inside the downloaded
// long-format file (per D74 owner-gate + Cache-Control: no-store).
//
// Submission method: GET form-style URL navigation via window.location.
// Browser handles the download natively via Content-Disposition: attachment
// (mirrors the existing /admin/exports/download contract). No new fetch
// boilerplate, no Loading state needed (browser shows its download UI).

import { useEffect, useMemo, useState } from "react";

// D86 — added "desktop" (ATLAS.ti Desktop bare-code format). "wide" stays
// as the Web-fallback target (D84). "long" is D74's per-answer shape.
type Shape = "wide" | "long" | "desktop";
type Format = "xlsx" | "csv";
type Scope = "single" | "bulk";

type ResponseOption = {
  responseId: string;
  refCode: string;
  categoryLbl: string;
  submittedAtLabel: string;
};

type Props = {
  options: ResponseOption[];
};

const CATEGORIES = [
  { value: "officials", label: "Officials" },
  { value: "researchers", label: "Researchers" },
  { value: "donors", label: "Donors" },
  { value: "ngos", label: "NGOs" },
] as const;

const NATIONALITIES = [
  { value: "jordanian", label: "Jordanian" },
  { value: "syrian", label: "Syrian" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
] as const;

export default function ExportModal({ options }: Props) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState<Shape>("wide");
  const [scope, setScope] = useState<Scope>("bulk");
  const [format, setFormat] = useState<Format>("xlsx");
  const [responseId, setResponseId] = useState("");
  const [category, setCategory] = useState<string[]>([]);
  const [nationality, setNationality] = useState<string[]>([]);
  const [language, setLanguage] = useState<string[]>([]);

  // ── Body scroll lock + Escape-to-close while modal is open ─────────
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ── Submit-button enablement gate ──────────────────────────────────
  // - single: needs a chosen responseId
  // - bulk wide / bulk desktop: needs exactly ONE category (Strategy 3
  //   single-variant invariant inherited by both shapes — see route
  //   defense in /admin/exports/download)
  // - bulk long: no category constraint (zero = all categories included)
  const canSubmit = useMemo(() => {
    if (scope === "single") return responseId.length > 0;
    if (shape === "wide" || shape === "desktop") return category.length === 1;
    return true; // bulk long
  }, [scope, shape, responseId, category]);

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  function buildHref(): string {
    const params = new URLSearchParams();
    params.set("scope", scope);
    params.set("format", format);
    params.set("shape", shape);
    if (scope === "single") {
      params.set("responseId", responseId);
    } else {
      if (category.length > 0) params.set("category", category.join(","));
      if (nationality.length > 0)
        params.set("nationality", nationality.join(","));
      if (language.length > 0) params.set("language", language.join(","));
    }
    return `/admin/exports/download?${params.toString()}`;
  }

  function onDownload() {
    if (!canSubmit) return;
    // Same-tab navigation. Server replies with Content-Disposition:
    // attachment so the browser handles the download without leaving
    // the modal page. We close the modal optimistically.
    window.location.href = buildHref();
    setOpen(false);
  }

  // ── When user flips shape ↔, reset category to satisfy invariants ─
  // - wide or desktop → bulk: enforce ≤1 category (Strategy 3 single-
  //   variant). If they had >1 selected, collapse to the first.
  // - long → bulk: no reset needed (multi-select allowed).
  // - desktop → format: force xlsx (D86 Q-3 — CSV disabled for desktop;
  //   ATLAS Desktop reads .xlsx natively, CSV adds zero value).
  function onShapeChange(next: Shape) {
    setShape(next);
    if ((next === "wide" || next === "desktop") && category.length > 1) {
      setCategory(category.slice(0, 1));
    }
    if (next === "desktop" && format === "csv") {
      setFormat("xlsx");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700"
      >
        Export responses
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4"
          onClick={(e) => {
            // Click-outside closes (target check prevents inner-card
            // clicks from bubbling).
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-semibold text-ink">
                Export responses
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted hover:text-ink text-[20px] leading-none"
              >
                ×
              </button>
            </div>

            {/* Shape — radio with one-line explainer each */}
            <fieldset className="mb-5">
              <legend className="block text-[12px] font-semibold text-ink mb-2">
                Format shape
              </legend>
              <label className="flex items-start gap-2 mb-2 cursor-pointer">
                <input
                  type="radio"
                  name="shape"
                  value="wide"
                  checked={shape === "wide"}
                  onChange={() => onShapeChange("wide")}
                  className="mt-0.5"
                />
                <span className="text-[13px]">
                  <span className="font-semibold text-ink">
                    ATLAS.ti Wide-format
                  </span>{" "}
                  <span className="text-muted">
                    — one row per respondent, one column per question. Pre-
                    coded for ATLAS.ti Survey Import. One questionnaire
                    variant per file.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 mb-2 cursor-pointer">
                <input
                  type="radio"
                  name="shape"
                  value="desktop"
                  checked={shape === "desktop"}
                  onChange={() => onShapeChange("desktop")}
                  className="mt-0.5"
                />
                <span className="text-[13px]">
                  <span className="font-semibold text-ink">
                    ATLAS.ti Desktop
                  </span>{" "}
                  <span className="text-muted">
                    — bare Q/F code column headers (no labels). Downloads
                    as a ZIP containing two XLSX files: a responses sheet
                    for <span className="mono">Import &gt; Survey</span>{" "}
                    and a codebook sheet for{" "}
                    <span className="mono">Import &gt; Codes</span> that
                    populates each code&apos;s comment with the full
                    question text. One questionnaire variant per file.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="shape"
                  value="long"
                  checked={shape === "long"}
                  onChange={() => onShapeChange("long")}
                  className="mt-0.5"
                />
                <span className="text-[13px]">
                  <span className="font-semibold text-ink">Long-format</span>{" "}
                  <span className="text-muted">
                    — one row per answer (D74 default). Includes recipient
                    name + email for supervisor review. Use for stats software
                    or cross-variant aggregation.
                  </span>
                </span>
              </label>
            </fieldset>

            {/* Scope — single vs bulk */}
            <fieldset className="mb-5">
              <legend className="block text-[12px] font-semibold text-ink mb-2">
                Scope
              </legend>
              <label className="inline-flex items-center gap-1.5 me-4 text-[13px] cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="bulk"
                  checked={scope === "bulk"}
                  onChange={() => setScope("bulk")}
                />
                Bulk (filtered)
              </label>
              <label className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="single"
                  checked={scope === "single"}
                  onChange={() => setScope("single")}
                />
                Single response
              </label>
            </fieldset>

            {/* Single-scope: response picker */}
            {scope === "single" && (
              <div className="mb-5">
                <label
                  htmlFor="responseId"
                  className="block text-[12px] font-semibold text-ink mb-1"
                >
                  Response
                </label>
                <select
                  id="responseId"
                  value={responseId}
                  onChange={(e) => setResponseId(e.target.value)}
                  className="w-full border border-line rounded-md px-3 py-2 text-[13px] bg-white"
                >
                  <option value="" disabled>
                    Choose a response…
                  </option>
                  {options.map((o) => (
                    <option key={o.responseId} value={o.responseId}>
                      {o.refCode} — {o.categoryLbl} · submitted{" "}
                      {o.submittedAtLabel}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Bulk-scope filters */}
            {scope === "bulk" && (
              <div className="space-y-4 mb-5">
                <fieldset>
                  <legend className="block text-[12px] font-semibold text-ink mb-1">
                    Category
                    {(shape === "wide" || shape === "desktop") && (
                      <span className="ms-2 text-[11px] font-normal text-muted">
                        — pick exactly one (ATLAS.ti needs a single variant)
                      </span>
                    )}
                    {shape === "long" && (
                      <span className="ms-2 text-[11px] font-normal text-muted">
                        — leave all unchecked to include every category
                      </span>
                    )}
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {CATEGORIES.map((c) => {
                      const singleSelect =
                        shape === "wide" || shape === "desktop";
                      return (
                        <label
                          key={c.value}
                          className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer"
                        >
                          <input
                            type={singleSelect ? "radio" : "checkbox"}
                            name={singleSelect ? "atlas-category" : undefined}
                            value={c.value}
                            checked={category.includes(c.value)}
                            onChange={() => {
                              if (singleSelect) {
                                setCategory([c.value]);
                              } else {
                                setCategory(toggleIn(category, c.value));
                              }
                            }}
                          />
                          {c.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="block text-[12px] font-semibold text-ink mb-1">
                    Nationality
                    <span className="ms-2 text-[11px] font-normal text-muted">
                      — leave all unchecked to include every nationality
                    </span>
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {NATIONALITIES.map((n) => (
                      <label
                        key={n.value}
                        className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          value={n.value}
                          checked={nationality.includes(n.value)}
                          onChange={() =>
                            setNationality(toggleIn(nationality, n.value))
                          }
                        />
                        {n.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="block text-[12px] font-semibold text-ink mb-1">
                    Language
                    <span className="ms-2 text-[11px] font-normal text-muted">
                      — leave all unchecked to include both
                    </span>
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {LANGUAGES.map((l) => (
                      <label
                        key={l.value}
                        className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          value={l.value}
                          checked={language.includes(l.value)}
                          onChange={() =>
                            setLanguage(toggleIn(language, l.value))
                          }
                        />
                        {l.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}

            {/* Format. D86 — CSV is disabled when shape=desktop (ATLAS
                Desktop reads .xlsx natively; CSV adds zero value and
                onShapeChange already forced format=xlsx on shape flip,
                so this is a UI-affordance layer on top of state).  */}
            <fieldset className="mb-6">
              <legend className="block text-[12px] font-semibold text-ink mb-1">
                File type
              </legend>
              <label className="inline-flex items-center gap-1.5 me-4 text-[13px] cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  value="xlsx"
                  checked={format === "xlsx"}
                  onChange={() => setFormat("xlsx")}
                />
                XLSX
                {(shape === "wide" || shape === "desktop") && (
                  <span className="ms-1 text-[11px] text-muted">
                    (recommended for ATLAS.ti)
                  </span>
                )}
              </label>
              <label
                className={
                  "inline-flex items-center gap-1.5 text-[13px] " +
                  (shape === "desktop"
                    ? "opacity-40 cursor-not-allowed"
                    : "cursor-pointer")
                }
              >
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={format === "csv"}
                  onChange={() => setFormat("csv")}
                  disabled={shape === "desktop"}
                />
                CSV (UTF-8 with BOM)
                {shape === "desktop" && (
                  <span className="ms-1 text-[11px] text-muted">
                    (XLSX only for ATLAS.ti Desktop)
                  </span>
                )}
              </label>
            </fieldset>

            {/* Footer — actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-line">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-md text-[13px] font-semibold text-muted hover:bg-bgAlt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={!canSubmit}
                className="px-4 py-2 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
