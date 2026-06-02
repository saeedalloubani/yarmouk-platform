// app/(public)/questionnaire/page.tsx
//
// Questionnaire (Server Component). All the load-bearing derivation
// happens here, server-side, before the client wizard renders:
//
//   Guard 1 — no session → redirect to /
//   Guard 2 — no consent record → redirect to /consent (consent gate)
//   Filter  — active version's questions, by nationality, ONCE (Edge 3),
//             ordered by order_index
//   Edge 2  — initialIdx = first-unanswered-visible (last if all answered)
//
// The wizard receives the FILTERED list + existing answers + initialIdx
// + lang. It never sees an unfiltered question source — a Jordanian's
// Q10–Q13 are absent from the props entirely.

import { redirect } from "next/navigation";
import { getSession, getLang } from "@/lib/cookies";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consentExistsForResponse } from "@/lib/repos/consent";
import { getVisibleQuestions } from "@/lib/repos/questions";
import { getAnswersMap } from "@/lib/repos/answers";
import QuestionnaireWizard, {
  type WizardQuestion,
} from "@/components/QuestionnaireWizard";

export const dynamic = "force-dynamic";

export default async function QuestionnairePage() {
  const session = await getSession();
  if (!session) redirect("/"); // guard 1

  const admin = createSupabaseAdminClient();

  if (!(await consentExistsForResponse(admin, session.responseId))) {
    redirect("/consent"); // guard 2 — can't answer without consenting
  }

  // Filter ONCE (Edge 3), ordered.
  const visible = await getVisibleQuestions(
    admin,
    session.questionnaireVersionId,
    session.nationality
  );
  if (visible.length === 0) redirect("/"); // defensive — nothing to answer

  const answersMap = await getAnswersMap(admin, session.responseId);

  // Edge 2: first unanswered visible question; if all answered, the last.
  let initialIdx = visible.findIndex(
    (q) => (answersMap[q.id] ?? "").trim().length === 0
  );
  if (initialIdx === -1) initialIdx = visible.length - 1;

  const lang = await getLang();

  const questions: WizardQuestion[] = visible.map((q) => ({
    id: q.id,
    code: q.code,
    textEn: q.textEn,
    textAr: q.textAr,
    isFeedback: q.isFeedback,
    isRequired: q.isRequired,
  }));

  // D68 — `category` prop dropped along with the wizard's header badge.
  // session.category is still available for any future per-category render
  // (e.g. tailored feedback intros) but isn't needed by the wizard today.
  return (
    <QuestionnaireWizard
      questions={questions}
      initialAnswers={answersMap}
      initialIdx={initialIdx}
      lang={lang}
    />
  );
}
