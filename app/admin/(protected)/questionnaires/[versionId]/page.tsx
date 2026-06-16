// app/admin/(protected)/questionnaires/[versionId]/page.tsx
//
// Single-version editor (Session 3 — question editor). OWNER-ONLY. A DRAFT
// version renders the interactive QuestionEditor; an ACTIVE/CLOSED version
// renders a frozen, read-only view (D10) — the editor is never shown for a
// non-draft version. The action draft-gate + the questions_draft_only
// trigger enforce the same boundary at the action and DB layers.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getVersion,
  getQuestionsForVersion,
  getOptionsForQuestions,
  variantLabel,
} from "@/lib/repos/questionnaires";
import QuestionEditor, {
  type EditorQuestionView,
} from "@/components/QuestionEditor";
import VersionLifecycleButton from "@/components/VersionLifecycleButton";

export const dynamic = "force-dynamic";

const VIS_LABEL: Record<string, string> = {
  all: "All respondents",
  jordanian: "Jordanian only",
  syrian: "Syrian only",
  both: "Jordanian + Syrian",
};

const ANSWER_TYPE_LABEL: Record<string, string> = {
  free_text: "Free text",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
};

function visKey(a: ("jordanian" | "syrian")[] | null): string {
  if (!a || a.length === 0) return "all";
  const j = a.includes("jordanian");
  const s = a.includes("syrian");
  if (j && s) return "both";
  if (s) return "syrian";
  if (j) return "jordanian";
  return "all";
}

export default async function EditVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // editor is owner-only

  const version = await getVersion(supabase, versionId);
  if (!version) notFound();

  const questions = await getQuestionsForVersion(supabase, versionId);
  // D102 — choice questions carry authored options (batch-loaded, ordered).
  const optionsByQuestion = await getOptionsForQuestions(
    supabase,
    questions.map((q) => q.id)
  );

  // Narrow visible_nationalities to the two the editor handles (drop the
  // unused 'not_applicable' enum value, which never occurs in practice).
  const views: EditorQuestionView[] = questions.map((q) => ({
    id: q.id,
    code: q.code,
    orderIndex: q.orderIndex,
    textEn: q.textEn,
    textAr: q.textAr,
    isFeedback: q.isFeedback,
    isRequired: q.isRequired,
    visibleNationalities: q.visibleNationalities
      ? q.visibleNationalities.filter(
          (n): n is "jordanian" | "syrian" => n === "jordanian" || n === "syrian"
        )
      : null,
    answerType: q.answerType,
    allowComment: q.allowComment,
    allowSkip: q.allowSkip,
    options: (optionsByQuestion.get(q.id) ?? []).map((o) => ({
      labelEn: o.labelEn,
      labelAr: o.labelAr,
    })),
  }));

  const isDraft = version.status === "draft";

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href="/admin/questionnaires" className="btn-ghost text-[13px] inline-block">
              ← Questionnaires
            </Link>
            <div className="flex items-start gap-3">
              <Link
                href={`/admin/questionnaires/${version.id}/preview`}
                className="btn-secondary text-[13px]"
              >
                Preview as respondent →
              </Link>
              {version.status === "draft" && (
                <VersionLifecycleButton
                  versionId={version.id}
                  mode="activate"
                  variantLabel={variantLabel(version.variant)}
                  versionNumber={version.versionNumber}
                />
              )}
              {version.status === "active" && (
                <VersionLifecycleButton
                  versionId={version.id}
                  mode="close"
                  variantLabel={variantLabel(version.variant)}
                  versionNumber={version.versionNumber}
                />
              )}
              {/* status === "closed" → no button (terminal state). */}
            </div>
          </div>
          <div className="eyebrow mb-1">{isDraft ? "Edit draft" : "View version"}</div>
          <h1 className="text-[22px] font-bold text-ink tracking-tight">
            <span className="text-brand-700">{variantLabel(version.variant)}</span>{" "}
            <span className="text-muted text-[16px]">v{version.versionNumber}</span>
          </h1>
          <p className="text-[13px] text-muted mt-1 capitalize">
            {version.type}
            {version.includesFeedbackBlock ? " · includes feedback block" : ""}
          </p>
        </div>

        {isDraft ? (
          <QuestionEditor
            versionId={version.id}
            includesFeedbackBlock={version.includesFeedbackBlock}
            questions={views}
          />
        ) : (
          <>
            <div className="notice-warn mb-6">
              <div>
                <strong>This version is {version.status} and frozen (D10).</strong>{" "}
                Questions can&apos;t be edited once a version leaves draft — to
                revise a live questionnaire, publish a new version (a later
                feature). Shown below read-only.
              </div>
            </div>
            {views.length === 0 ? (
              <p className="text-[13px] text-muted">No questions.</p>
            ) : (
              <ol className="space-y-3">
                {views.map((q) => (
                  <li key={q.id} className="card p-5">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="mono text-[11px] font-semibold text-brand-700">{q.code}</span>
                      {q.isFeedback && <span className="chip-solid bg-brand-50 text-brand-700">feedback</span>}
                      <span className="chip-solid bg-bgAlt text-muted">{q.isRequired ? "required" : "optional"}</span>
                      <span className="chip-solid bg-bgAlt text-muted">{VIS_LABEL[visKey(q.visibleNationalities)]}</span>
                      <span className="chip-solid bg-bgAlt text-muted">{ANSWER_TYPE_LABEL[q.answerType] ?? q.answerType}</span>
                    </div>
                    <p className="text-[13px] text-ink mb-1">{q.textEn}</p>
                    <p className="text-[13px] text-ink/80 font-arabic mb-1" dir="rtl">{q.textAr}</p>
                    {q.answerType !== "free_text" && q.options.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {q.options.map((o, oi) => (
                          <li key={oi} className="text-[12px] text-muted flex flex-wrap gap-x-2">
                            <span>{oi + 1}. {o.labelEn}</span>
                            <span className="font-arabic" dir="rtl">{o.labelAr}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(q.allowComment || q.allowSkip) && (
                      <p className="text-[11px] text-muted-faint mt-2">
                        {[q.allowComment ? "comment allowed" : null, q.allowSkip ? "skippable" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </main>
  );
}
