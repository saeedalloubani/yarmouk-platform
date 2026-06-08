// app/admin/(protected)/analytics/questions/page.tsx
//
// D87 — Per-question pivot view. Sura picks (variant, version) and
// then a question; the page lays out every submitted respondent's
// answer to that question side-by-side, EN/AR, with demographics
// chips and category/nationality filters. Built to displace
// "open ATLAS just to read everyone's Q8" — descriptive read in OUR
// UI, ATLAS reserved for deep thematic coding.
//
// ─── ACCESS MODEL ────────────────────────────────────────────────────
//
// BOTH ROLES (matches /admin/analytics/feedback): non-PII research
// data, ref_code is the public handle. No owner gate. Auth guard sits
// in the parent (protected) layout via AdminShell.
//
// ─── URL CONTRACT ────────────────────────────────────────────────────
//
//   ?v=<versionId>   — selected (variant, version). Default-picks the
//                      most recently active version of the first
//                      canonical variant when absent (see
//                      pickDefaultVersionId).
//   ?q=<questionId>  — selected question UUID. Defaults to first
//                      non-feedback question by order_index ASC, then
//                      falls back to first question of any kind. The
//                      grouping is by UUID (NOT code) — see
//                      lib/repos/analytics.ts header for the merge-trap
//                      reasoning.
//   ?cat=<category>  — category filter ('all' | 'officials' |
//                      'researchers' | 'donors' | 'ngos'). Default 'all'.
//   ?nat=<nat>       — nationality filter ('all' | 'jordanian' |
//                      'syrian'). Default 'all'.
//
// Invalid / unknown params fall back to defaults silently — the page
// is never blank when there's data.
//
// ─── SCOPE LOCK ──────────────────────────────────────────────────────
//
// Single (variant, version) pivot ONLY. No cross-variant pooling, no
// cross-version pooling, no in-answer search, no inline tagging, no
// export-from-pivot, no charts, no word-count stats. Pure read of
// answers grouped by question.id, decorated with demographics. Future
// D-numbers can layer.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/repos/invitations";
import { variantLabel } from "@/lib/repos/questionnaires";
import {
  listAnalyticsVersions,
  pickDefaultVersionId,
  getPivotForVersion,
  type PivotAnswer,
  type PivotQuestion,
  type AnalyticsVariantVersion,
} from "@/lib/repos/analytics";
import AnalyticsQuestionsControls from "@/components/AnalyticsQuestionsControls";

export const dynamic = "force-dynamic";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Search-param sanitizers. Next 15 hands a Promise<{[k]: string|string[]}>.
function strParam(
  raw: string | string[] | undefined
): string | undefined {
  if (raw === undefined) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const CATEGORY_VALUES = new Set([
  "all",
  "officials",
  "researchers",
  "donors",
  "ngos",
]);
const NATIONALITY_VALUES = new Set(["all", "jordanian", "syrian"]);

function pickCategory(raw: string | undefined): string {
  if (raw && CATEGORY_VALUES.has(raw)) return raw;
  return "all";
}
function pickNationality(raw: string | undefined): string {
  if (raw && NATIONALITY_VALUES.has(raw)) return raw;
  return "all";
}

/** Choose the default question for a version: the first non-feedback
 *  question by order_index, else fall back to the first question of any
 *  kind (covers a hypothetical feedback-only variant — none exist today,
 *  but no reason to render blank). */
function pickDefaultQuestionId(
  questions: PivotQuestion[]
): string | null {
  if (questions.length === 0) return null;
  const firstQ = questions.find((q) => !q.isFeedback);
  return (firstQ ?? questions[0]).questionId;
}

export default async function AnalyticsQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  // 1. Version list (sorted; submitted-counts decorated).
  const versions = await listAnalyticsVersions(supabase);

  // 2. Resolve selected versionId.
  const requestedVersionId = strParam(sp.v);
  const knownVersionId = versions.find(
    (v) => v.versionId === requestedVersionId
  )?.versionId;
  const selectedVersionId =
    knownVersionId ?? pickDefaultVersionId(versions);

  // 3. Global empty state: no versions exist at all (fresh DB).
  if (selectedVersionId === null) {
    return (
      <main className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <PageHeader />
          <div className="card p-8 text-center text-[14px] text-muted">
            No questionnaires exist yet — per-question pivot becomes
            available once a version is created.
          </div>
        </div>
      </main>
    );
  }

  // 4. Pivot bundle for the selected version.
  const pivot = await getPivotForVersion(supabase, selectedVersionId);
  // pivot is non-null because selectedVersionId came from the versions
  // list we just fetched. Belt + suspenders for the type narrowing:
  if (!pivot) {
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

  // 5. Resolve selected questionId.
  const requestedQuestionId = strParam(sp.q);
  const knownQuestionId = pivot.questions.find(
    (q) => q.questionId === requestedQuestionId
  )?.questionId;
  const selectedQuestionId =
    knownQuestionId ?? pickDefaultQuestionId(pivot.questions);

  // 6. Filters.
  const categoryFilter = pickCategory(strParam(sp.cat));
  const nationalityFilter = pickNationality(strParam(sp.nat));

  // 7. Resolve the selected question + answers (with filters applied).
  const selectedQuestion = selectedQuestionId
    ? pivot.questions.find((q) => q.questionId === selectedQuestionId) ?? null
    : null;

  const rawAnswers = selectedQuestion
    ? pivot.answersByQuestionId.get(selectedQuestion.questionId) ?? []
    : [];
  const filteredAnswers = rawAnswers.filter((a) => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (
      nationalityFilter !== "all" &&
      (a.nationality ?? "") !== nationalityFilter
    )
      return false;
    return true;
  });

  // 8. Render.
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <PageHeader />

        <VersionSummary version={pivot.version} />

        <AnalyticsQuestionsControls
          versions={versions}
          questions={pivot.questions}
          selectedVersionId={selectedVersionId}
          selectedQuestionId={selectedQuestionId ?? ""}
          categoryFilter={categoryFilter}
          nationalityFilter={nationalityFilter}
        />

        {selectedQuestion === null ? (
          <div className="card p-8 text-center text-[14px] text-muted mt-6">
            This questionnaire version has no questions yet.
          </div>
        ) : (
          <QuestionPivot
            question={selectedQuestion}
            answers={filteredAnswers}
            totalUnfiltered={rawAnswers.length}
            filtersActive={
              categoryFilter !== "all" || nationalityFilter !== "all"
            }
          />
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
        Per-Question Pivot
      </h1>
      <p className="text-[13px] text-muted mt-1">
        Compare every respondent&apos;s answer to a single question, side
        by side. Filter by category and nationality. Submitted responses
        only.
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

function QuestionPivot({
  question,
  answers,
  totalUnfiltered,
  filtersActive,
}: {
  question: PivotQuestion;
  answers: PivotAnswer[];
  totalUnfiltered: number;
  filtersActive: boolean;
}) {
  return (
    <section className="card p-6 mt-6">
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <span className="mono text-[12px] font-bold text-brand-700">
          {question.questionCode}
        </span>
        {question.isFeedback && (
          <span className="chip-solid bg-bgAlt text-muted text-[11px]">
            feedback
          </span>
        )}
        {question.visibleNationalities &&
          question.visibleNationalities.length > 0 && (
            <span className="chip-solid bg-accent-50 text-accent-700 text-[11px] capitalize">
              {question.visibleNationalities.join(", ")}-only
            </span>
          )}
        <span className="text-[11px] text-muted">
          {answers.length} of {totalUnfiltered}{" "}
          {totalUnfiltered === 1 ? "response" : "responses"}
          {filtersActive && totalUnfiltered !== answers.length
            ? " (filtered)"
            : ""}
        </span>
      </div>
      <h2 className="text-[15px] font-semibold text-ink">{question.textEn}</h2>
      {question.textAr && (
        <p className="text-[13px] text-muted mt-0.5" dir="rtl">
          {question.textAr}
        </p>
      )}

      {answers.length === 0 ? (
        <p className="text-[13px] text-muted mt-4">
          {totalUnfiltered === 0
            ? "No responses to this question yet."
            : "No responses match the current filters."}
        </p>
      ) : (
        <ul className="mt-4">
          {answers.map((a) => (
            <li
              key={a.responseId}
              className="border-t border-line py-3 first:border-t-0"
            >
              <p
                className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap"
                dir="auto"
              >
                {a.answerText || (
                  <span className="text-muted italic">(no answer text)</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-muted">
                <span className="mono text-brand-700">{a.refCode}</span>
                <span className="chip-solid bg-brand-50 text-brand-700">
                  {categoryLabel(a.category)}
                </span>
                {a.nationality && (
                  <span className="chip-solid bg-accent-50 text-accent-700 capitalize">
                    {a.nationality}
                  </span>
                )}
                <span className="uppercase">{a.language}</span>
                <span className="text-muted-faint">
                  · {fmtWhen(a.submittedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
