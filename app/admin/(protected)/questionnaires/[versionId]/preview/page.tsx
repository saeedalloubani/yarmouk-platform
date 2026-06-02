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
import type { Database } from "@/lib/supabase/database.types";
import type { PilotCategory } from "@/lib/i18n";
import QuestionnairePreview, {
  type PreviewQuestion,
} from "@/components/QuestionnairePreview";

export const dynamic = "force-dynamic";

// D67 — Map a questionnaire variant to its pilot category, or null for
// non-pilot / legacy-combined variants. Exhaustive switch — TypeScript flags
// any future variant enum addition that isn't accounted for.
//
// D68 — Unused since D68 (the preview badge was removed alongside the live
// wizard's badge). Retained for potential future use (e.g. a variant-aware
// preview chrome that surfaces "you're previewing X variant" at the top);
// remove in a later cleanup cycle. Intentional dead code — paired with
// `pilotBadgeLabel` + the `pilotBadgeX` i18n keys in `lib/i18n.ts`.
type QuestionnaireVariant =
  Database["public"]["Enums"]["questionnaire_variant"];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function variantToPilotCategory(
  variant: QuestionnaireVariant
): PilotCategory | null {
  switch (variant) {
    case "pilot_officials":
      return "officials";
    case "pilot_researchers":
      return "researchers";
    case "pilot_donors":
      return "donors";
    case "pilot_ngos":
      return "ngos";
    case "pilot_researchers_donors_ngos":
      // Legacy combined variant (pre-split, see migration 20260524140002).
      return null;
    case "main_researchers":
    case "main_donors":
    case "main_ngos":
    case "main_officials_jordanian":
    case "main_officials_syrian":
      return null;
  }
}

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

  // D68 — `pilotCategory` prop dropped along with the preview's header
  // badge. `variantToPilotCategory` survives as dead code (see header
  // comment) in case a future variant-aware preview chrome wants it.
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
