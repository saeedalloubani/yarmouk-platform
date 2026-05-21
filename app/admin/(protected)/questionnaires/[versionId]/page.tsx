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
} from "@/lib/repos/questionnaires";
import QuestionEditor, {
  type EditorQuestionView,
} from "@/components/QuestionEditor";

export const dynamic = "force-dynamic";

const VIS_LABEL: Record<string, string> = {
  all: "All respondents",
  jordanian: "Jordanian only",
  syrian: "Syrian only",
  both: "Jordanian + Syrian",
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
  }));

  const isDraft = version.status === "draft";

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6">
          <Link href="/admin/questionnaires" className="btn-ghost text-[13px] mb-4 inline-block">
            ← Questionnaires
          </Link>
          <div className="eyebrow mb-1">{isDraft ? "Edit draft" : "View version"}</div>
          <h1 className="text-[22px] font-bold text-ink tracking-tight">
            <span className="mono text-brand-700">{version.variant}</span>{" "}
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
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="mono text-[11px] font-semibold text-brand-700">{q.code}</span>
                      {q.isFeedback && <span className="chip-solid bg-brand-50 text-brand-700">feedback</span>}
                      <span className="chip-solid bg-bgAlt text-muted">{q.isRequired ? "required" : "optional"}</span>
                      <span className="chip-solid bg-bgAlt text-muted">{VIS_LABEL[visKey(q.visibleNationalities)]}</span>
                    </div>
                    <p className="text-[13px] text-ink mb-1">{q.textEn}</p>
                    <p className="text-[13px] text-ink/80 font-arabic" dir="rtl">{q.textAr}</p>
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
