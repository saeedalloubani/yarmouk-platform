// app/admin/(protected)/questionnaires/[versionId]/preview/page.tsx
//
// OWNER-ONLY read-only preview of a questionnaire variant as a respondent
// would see it (one-question-per-page, EN/AR, RTL, nationality gating) — built
// to proof the DRAFT pilot variants before activation. It loads the version +
// its FULL unfiltered question set and hands them to a standalone, write-free
// client component (QuestionnairePreview). It deliberately does NOT reuse the
// live QuestionnaireWizard, whose navigation is coupled to autosave/submit.
//
// Works on DRAFT versions (the point) — getVersion/getQuestionsForVersion have
// no active requirement. No session/consent/response is involved; the owner
// gate is the only guard.

import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getVersion,
  getQuestionsForVersion,
  variantLabel,
} from "@/lib/repos/questionnaires";
import QuestionnairePreview, {
  type PreviewQuestion,
} from "@/components/QuestionnairePreview";

export const dynamic = "force-dynamic";

export default async function PreviewVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // preview is owner-only

  const version = await getVersion(supabase, versionId);
  if (!version) notFound();

  const questions = await getQuestionsForVersion(supabase, versionId);

  const previewQuestions: PreviewQuestion[] = questions.map((q) => ({
    id: q.id,
    code: q.code,
    orderIndex: q.orderIndex,
    textEn: q.textEn,
    textAr: q.textAr,
    isRequired: q.isRequired,
    isFeedback: q.isFeedback,
    visibleNationalities: q.visibleNationalities,
  }));

  // Gated = any question restricted by nationality (only officials). Drives
  // whether the Jordanian/Syrian toggle is shown.
  const hasGated = previewQuestions.some(
    (q) => q.visibleNationalities != null && q.visibleNationalities.length > 0
  );

  // D68 — pilot badge removed; preview header no longer needs a per-category
  // prop. D69 — `variantToPilotCategory` removed as part of the dead-code
  // cleanup batch.
  return (
    <QuestionnairePreview
      versionLabel={variantLabel(version.variant)}
      versionNumber={version.versionNumber}
      status={version.status}
      questions={previewQuestions}
      hasGated={hasGated}
      editHref={`/admin/questionnaires/${versionId}`}
    />
  );
}
