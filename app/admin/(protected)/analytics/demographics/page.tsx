// app/admin/(protected)/analytics/demographics/page.tsx
//
// D88 — "Who's in my sample" overview for a selected (variant,
// version). Category × Nationality matrix, language counts, completion-
// time stats, response-length stats. Variant-scoped from day one —
// same one-platform-many-variants model as D87.
//
// ─── ACCESS MODEL ────────────────────────────────────────────────────
//
// BOTH ROLES (matches /admin/analytics/questions and /feedback): all
// figures here are non-PII aggregate counts. ref_code-level data is
// not surfaced (this is an overview view, not a per-respondent
// listing). Auth guard sits in the parent (protected) layout via
// AdminShell.
//
// ─── URL CONTRACT ────────────────────────────────────────────────────
//
//   ?v=<versionId>   — selected (variant, version). Default-picks via
//                      D87's pickDefaultVersionId (most recently
//                      active version of the first canonical variant).
//
// No question/filter params — the demographics overview has no per-
// question or category/nationality filter. The matrix IS the
// breakdown; further filtering would be the per-question pivot
// (/analytics/questions), not here.
//
// ─── SCOPE LOCK ──────────────────────────────────────────────────────
//
// Variant+version scoped. NO cross-variant / cross-version pooling.
// NO charts/graphs, NO per-question length, NO export, NO cross-
// variant comparison. Pure aggregate read.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/repos/invitations";
import { variantLabel } from "@/lib/repos/questionnaires";
import {
  listAnalyticsVersions,
  pickDefaultVersionId,
  type AnalyticsVariantVersion,
} from "@/lib/repos/analytics";
import {
  getDemographicsForVersion,
  nationalityColumnLabel,
  DEMOGRAPHICS_NATIONALITY_COLUMNS,
  type DemographicsMatrix,
  type LanguageCounts,
  type DurationStats,
  type WordStats,
} from "@/lib/repos/analytics-demographics";
import AnalyticsVersionSelector from "@/components/AnalyticsVersionSelector";

export const dynamic = "force-dynamic";

function strParam(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** "N/A" cell renderer — zero counts shown as a dimmed em-dash so the
 *  table reads as composition-at-a-glance, not "loading" or "error".
 *  Non-zero counts render as plain numerals. */
function cellNum(n: number): React.ReactNode {
  if (n === 0) {
    return <span className="text-muted-faint">—</span>;
  }
  return <span className="font-medium text-ink">{n}</span>;
}

function statLine(label: string, value: number | null, unit: string) {
  return (
    <div className="flex items-baseline justify-between text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="mono text-ink">
        {value === null ? "—" : `${value} ${unit}`}
      </span>
    </div>
  );
}

export default async function AnalyticsDemographicsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  // 1. Version list (D87 export, reused verbatim).
  const versions = await listAnalyticsVersions(supabase);

  // 2. Resolve selected versionId (D87 default-pick semantics).
  const requestedVersionId = strParam(sp.v);
  const knownVersionId = versions.find(
    (v) => v.versionId === requestedVersionId
  )?.versionId;
  const selectedVersionId =
    knownVersionId ?? pickDefaultVersionId(versions);

  if (selectedVersionId === null) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <PageHeader />
          <div className="card p-8 text-center text-[14px] text-muted">
            No questionnaires exist yet — demographics overview becomes
            available once a version is created.
          </div>
        </div>
      </main>
    );
  }

  // 3. Demographics bundle for the selected version.
  const data = await getDemographicsForVersion(supabase, selectedVersionId);
  if (!data) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <PageHeader />
          <div className="card p-8 text-center text-[14px] text-muted">
            Selected questionnaire version no longer exists. Reload to
            reset.
          </div>
        </div>
      </main>
    );
  }

  // We render the matrix selector summary from the DECORATED version
  // (which has submittedCount); the per-cohort total comes from data.
  // matrix.totalSubmitted. Both should agree.
  const decoratedVersion =
    versions.find((v) => v.versionId === selectedVersionId) ?? data.version;

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <PageHeader />

        <VersionSummary version={decoratedVersion} />

        <AnalyticsVersionSelector
          versions={versions}
          selectedVersionId={selectedVersionId}
        />

        {data.matrix.totalSubmitted === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted mt-6">
            No responses submitted yet for this variant + version.
            Demographics appear here once respondents complete the
            questionnaire.
          </div>
        ) : (
          <>
            <HonestyCopy />
            <MatrixCard matrix={data.matrix} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <LanguageCard counts={data.languageCounts} />
              <DurationCard stats={data.duration} />
              <WordsCard stats={data.words} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ─── small composing pieces ──────────────────────────────────────────

function PageHeader() {
  return (
    <div className="mb-6">
      <div className="eyebrow mb-1">Analytics</div>
      <h1 className="text-[24px] font-bold text-ink tracking-tight">
        Demographics
      </h1>
      <p className="text-[13px] text-muted mt-1">
        Who&apos;s in this sample? Category × nationality matrix,
        language, completion time, and response length — for the
        selected variant + version, submitted responses only.
      </p>
    </div>
  );
}

function VersionSummary({
  version,
}: {
  version: AnalyticsVariantVersion;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px]">
      <span className="chip-solid bg-brand-50 text-brand-700">
        {variantLabel(version.variant)}
      </span>
      <span className="chip-solid bg-bgAlt text-muted mono">
        v{version.versionNumber}
      </span>
      {version.status === "active" ? (
        <span className="chip-solid bg-warnLight text-warn">active</span>
      ) : version.status === "draft" ? (
        <span className="chip-solid bg-bgAlt text-muted">draft</span>
      ) : (
        <span className="chip-solid bg-bgAlt text-muted">closed</span>
      )}
      <span className="text-muted">
        · {version.submittedCount} submitted{" "}
        {version.submittedCount === 1 ? "response" : "responses"}
      </span>
    </div>
  );
}

function HonestyCopy() {
  return (
    <p className="text-[12px] text-muted mt-6 italic">
      At pilot scale these are indicative, not statistical — main-study
      volume will firm them up.
    </p>
  );
}

function MatrixCard({ matrix }: { matrix: DemographicsMatrix }) {
  return (
    <section className="card p-6 mt-2">
      <h2 className="text-[15px] font-semibold text-ink mb-3">
        Category × Nationality
      </h2>
      <table className="w-full text-[13px]">
        <thead className="text-muted">
          <tr>
            <th className="text-start font-semibold pb-2 pe-4">Category</th>
            {DEMOGRAPHICS_NATIONALITY_COLUMNS.map((col) => (
              <th
                key={col}
                className="text-end font-semibold pb-2 ps-4 mono"
                title={
                  col === "na"
                    ? "N/A — nationality not gated for this category (folds the 'not_applicable' enum value and any unset nationality)."
                    : undefined
                }
              >
                {nationalityColumnLabel(col)}
              </th>
            ))}
            <th className="text-end font-semibold pb-2 ps-4 mono">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.categoriesPresent.map((cat) => {
            const row = matrix.cells.get(cat);
            const rowTotal = row
              ? DEMOGRAPHICS_NATIONALITY_COLUMNS.reduce(
                  (s, col) => s + (row.get(col) ?? 0),
                  0
                )
              : 0;
            return (
              <tr key={cat} className="border-t border-line">
                <td className="py-2 pe-4 font-medium text-ink">
                  {categoryLabel(cat)}
                </td>
                {DEMOGRAPHICS_NATIONALITY_COLUMNS.map((col) => (
                  <td key={col} className="py-2 ps-4 text-end mono">
                    {cellNum(row?.get(col) ?? 0)}
                  </td>
                ))}
                <td className="py-2 ps-4 text-end mono">
                  {cellNum(rowTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="text-muted">
          <tr className="border-t border-line">
            <td className="pt-2 pe-4 font-semibold">All categories</td>
            {DEMOGRAPHICS_NATIONALITY_COLUMNS.map((col) => {
              const colTotal = matrix.categoriesPresent.reduce(
                (s, cat) => s + (matrix.cells.get(cat)?.get(col) ?? 0),
                0
              );
              return (
                <td key={col} className="pt-2 ps-4 text-end mono">
                  {cellNum(colTotal)}
                </td>
              );
            })}
            <td className="pt-2 ps-4 text-end mono font-semibold text-ink">
              {matrix.totalSubmitted}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-[11px] text-muted mt-3">
        N/A — nationality not gated for this category.
      </p>
    </section>
  );
}

function LanguageCard({ counts }: { counts: LanguageCounts }) {
  const total = counts.en + counts.ar;
  return (
    <section className="card p-5">
      <h3 className="text-[13px] font-semibold text-ink mb-2">Language</h3>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">English</span>
          <span className="mono text-ink">{counts.en}</span>
        </div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">Arabic</span>
          <span className="mono text-ink">{counts.ar}</span>
        </div>
        <div className="border-t border-line pt-1.5 mt-1.5 flex items-baseline justify-between text-[12px] text-muted">
          <span>Total</span>
          <span className="mono">{total}</span>
        </div>
      </div>
    </section>
  );
}

function DurationCard({ stats }: { stats: DurationStats }) {
  const total = stats.count + stats.excluded;
  return (
    <section className="card p-5">
      <h3 className="text-[13px] font-semibold text-ink mb-2">
        Completion time
      </h3>
      <div className="space-y-1.5">
        {statLine("min", stats.min, "min")}
        {statLine("median", stats.median, "min")}
        {statLine("mean", stats.mean, "min")}
        {statLine("max", stats.max, "min")}
        <div className="border-t border-line pt-1.5 mt-1.5 text-[11px] text-muted">
          Duration available for {stats.count} of {total}{" "}
          {total === 1 ? "response" : "responses"}
          {stats.excluded > 0 && (
            <> ({stats.excluded} excluded — start milestone missing)</>
          )}
          .
        </div>
      </div>
    </section>
  );
}

function WordsCard({ stats }: { stats: WordStats }) {
  return (
    <section className="card p-5">
      <h3 className="text-[13px] font-semibold text-ink mb-2">
        Response length
      </h3>
      <div className="space-y-1.5">
        {statLine("min", stats.min, "words")}
        {statLine("median", stats.median, "words")}
        {statLine("mean", stats.mean, "words")}
        {statLine("max", stats.max, "words")}
        <div className="border-t border-line pt-1.5 mt-1.5 text-[11px] text-muted">
          Total words per submitted response, across {stats.count}{" "}
          {stats.count === 1 ? "response" : "responses"}.
        </div>
      </div>
    </section>
  );
}

