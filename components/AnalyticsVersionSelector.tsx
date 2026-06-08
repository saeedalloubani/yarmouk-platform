"use client";

// components/AnalyticsVersionSelector.tsx
//
// D88 — Slim variant+version selector. Used by analytics pages that
// only need the cohort picker (not a question picker or filter strip).
// Sister to components/AnalyticsQuestionsControls (D87), which carries
// the full 4-control bundle for the question pivot. This one is a
// single dropdown — the demographics page (and any future overview
// sibling) doesn't need anything more.
//
// State lives in the URL (?v=…). Changing the dropdown calls
// router.replace with the new query string; the server page re-renders
// with the new cohort bundle. router.replace not push — dropdown
// twiddling shouldn't accumulate history entries (same reasoning as
// D87's controls).

import { useRouter, useSearchParams } from "next/navigation";
import { variantLabel } from "@/lib/repos/questionnaires";
import type { AnalyticsVariantVersion } from "@/lib/repos/analytics";

type Props = {
  versions: AnalyticsVariantVersion[];
  selectedVersionId: string;
};

export default function AnalyticsVersionSelector({
  versions,
  selectedVersionId,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function setVersion(value: string) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value) next.set("v", value);
    else next.delete("v");
    router.replace(`?${next.toString()}`);
  }

  return (
    <div className="card p-4">
      <label className="block">
        <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Variant &amp; version
        </span>
        <div className="mt-1">
          <select
            value={selectedVersionId}
            onChange={(e) => setVersion(e.target.value)}
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
        </div>
      </label>
    </div>
  );
}
