"use client";

// components/AnalyticsQuestionsControls.tsx
//
// D87 — Selector + filter strip for the per-question pivot. Three
// dropdowns + a "Reset filters" hint:
//
//   1. Variant + Version  — drives the page-level data fetch.
//   2. Question           — picks which question's answers to render.
//   3. Category            — 'all' or one of the 4 categories.
//   4. Nationality         — 'all' / 'jordanian' / 'syrian'.
//
// State lives in the URL (?v=…&q=…&cat=…&nat=…). Changing any control
// calls router.replace with the new query string; the server page re-
// renders with the new bundle. No client-side data fetching, no React
// state for the values themselves — everything reads back from props
// each render (controlled by the URL via the parent).
//
// Why router.replace (not push)? The history shouldn't accumulate one
// entry per dropdown twiddle — that traps the user in their own back-
// button. Replace keeps the "you're on /admin/analytics/questions"
// state stable; only navigating away creates a real history entry.

import { useRouter, useSearchParams } from "next/navigation";
import { variantLabel } from "@/lib/repos/questionnaires";
import { categoryLabel } from "@/lib/repos/invitations";
import type {
  AnalyticsVariantVersion,
  PivotQuestion,
} from "@/lib/repos/analytics";

type Props = {
  versions: AnalyticsVariantVersion[];
  questions: PivotQuestion[];
  selectedVersionId: string;
  selectedQuestionId: string;
  categoryFilter: string; // 'all' | 'officials' | ...
  nationalityFilter: string; // 'all' | 'jordanian' | 'syrian'
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "officials", label: categoryLabel("officials") },
  { value: "researchers", label: categoryLabel("researchers") },
  { value: "donors", label: categoryLabel("donors") },
  { value: "ngos", label: categoryLabel("ngos") },
];

const NATIONALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All nationalities" },
  { value: "jordanian", label: "Jordanian" },
  { value: "syrian", label: "Syrian" },
];

export default function AnalyticsQuestionsControls({
  versions,
  questions,
  selectedVersionId,
  selectedQuestionId,
  categoryFilter,
  nationalityFilter,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function updateParam(key: string, value: string, resetKeys: string[] = []) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === "all" || value === "") next.delete(key);
    else next.set(key, value);
    // Reset cascading params (e.g. switching variant clears question +
    // filters since their values are version-scoped UUIDs / may not
    // apply to the new dataset).
    for (const k of resetKeys) next.delete(k);
    router.replace(`?${next.toString()}`);
  }

  const anyFilterActive =
    categoryFilter !== "all" || nationalityFilter !== "all";

  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Variant &amp; version">
          <select
            value={selectedVersionId}
            onChange={(e) =>
              // Changing the version invalidates the question selection
              // (versions own their own question UUIDs). Clear ?q and
              // let the server pick the default for the new version.
              updateParam("v", e.target.value, ["q"])
            }
            className="field text-[13px]"
          >
            {versions.map((v) => (
              <option key={v.versionId} value={v.versionId}>
                {variantLabel(v.variant)} · v{v.versionNumber}
                {" · "}
                {v.status}
                {" · "}
                {v.submittedCount} submitted
              </option>
            ))}
          </select>
        </Field>

        <Field label="Question">
          <select
            value={selectedQuestionId}
            onChange={(e) => updateParam("q", e.target.value)}
            className="field text-[13px]"
          >
            {questions.map((q) => (
              <option key={q.questionId} value={q.questionId}>
                {q.questionCode}
                {q.isFeedback ? " · feedback" : ""}
                {" — "}
                {truncate(q.textEn, 80)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <select
            value={categoryFilter}
            onChange={(e) => updateParam("cat", e.target.value)}
            className="field text-[13px]"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nationality">
          <select
            value={nationalityFilter}
            onChange={(e) => updateParam("nat", e.target.value)}
            className="field text-[13px]"
          >
            {NATIONALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {anyFilterActive && (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params?.toString() ?? "");
            next.delete("cat");
            next.delete("nat");
            router.replace(`?${next.toString()}`);
          }}
          className="text-[12px] text-brand-700 hover:underline"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
