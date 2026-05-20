"use server";

// lib/actions/answers.ts
//
// saveAnswer (autosave) + submitQuestionnaire (gate + finalize).
// Both derive response_id / invitation_id / nationality / version from
// the session cookie — never from client arguments — so a crafted call
// can't touch another respondent's data. Public-flow admin client (D48).

import { redirect } from "next/navigation";
import { getSession, clearSessionCookie } from "@/lib/cookies";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getVisibleQuestions } from "@/lib/repos/questions";
import { upsertAnswer, getAnsweredQuestionIds } from "@/lib/repos/answers";

// ---- saveAnswer (autosave) ----
export async function saveAnswer(
  questionId: string,
  text: string
): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };

  const admin = createSupabaseAdminClient();

  // Reject writes to a finalized or locked response. "Submit" isn't
  // truly final without this: a replayed saveAnswer after submission
  // would otherwise upsert into a submitted response, mutating
  // finalized research data. Answer-side equivalent of the submit gate.
  const { data: resp } = await admin
    .from("responses")
    .select("submitted_at, is_locked")
    .eq("id", session.responseId)
    .maybeSingle();
  if (!resp || resp.submitted_at !== null || resp.is_locked) {
    return { ok: false };
  }

  // Defense: questionId must be in this respondent's visible set (Edge 3).
  // Stops a crafted call writing answers to filtered-out questions
  // (e.g. a Jordanian writing Q10).
  const visible = await getVisibleQuestions(
    admin,
    session.questionnaireVersionId,
    session.nationality
  );
  if (!visible.some((q) => q.id === questionId)) return { ok: false };

  // 1. Upsert the answer FIRST (the more valuable write).
  const { error: upsertErr } = await upsertAnswer(
    admin,
    session.responseId,
    questionId,
    text
  );
  if (upsertErr) {
    console.error("[answers] upsert failed", upsertErr);
    return { ok: false };
  }

  // 2. THEN flip the invitation opened→started (Task #10). Guarded by
  //    status='opened' so it fires once and is idempotent. Ordered
  //    after the upsert so a failure here still leaves the answer saved.
  const { error: statusErr } = await admin
    .from("invitations")
    .update({ status: "started", started_at: new Date().toISOString() })
    .eq("id", session.invitationId)
    .eq("status", "opened");
  if (statusErr) {
    // Non-fatal: the answer is saved; status self-heals on the next save.
    console.error("[answers] opened→started flip failed", statusErr);
  }

  return { ok: true };
}

// ---- submitQuestionnaire (gate + finalize) ----
// Success redirects to /submitted; only gate failures return.
export type SubmitResult = { ok: false; missing: string[] };

export async function submitQuestionnaire(): Promise<SubmitResult> {
  const session = await getSession();
  if (!session) redirect("/");

  const admin = createSupabaseAdminClient();

  // Re-derive the VISIBLE REQUIRED set server-side (D47) — never trust client.
  const visible = await getVisibleQuestions(
    admin,
    session.questionnaireVersionId,
    session.nationality
  );
  const visibleRequired = visible.filter((q) => q.isRequired);

  const answered = await getAnsweredQuestionIds(admin, session.responseId);

  const missing = visibleRequired
    .filter((q) => !answered.has(q.id))
    .map((q) => q.code);
  if (missing.length > 0) return { ok: false, missing };

  // Finalize. responses.submitted_at is the re-entry source of truth
  // (validate_invitation_token keys off it). Guarded for idempotency.
  const nowIso = new Date().toISOString();
  const { error: rErr } = await admin
    .from("responses")
    .update({ submitted_at: nowIso })
    .eq("id", session.responseId)
    .is("submitted_at", null);
  if (rErr) {
    console.error("[submit] responses finalize failed", rErr);
    return { ok: false, missing: [] };
  }

  // invitations status/timestamp for dashboard accuracy.
  await admin
    .from("invitations")
    .update({ status: "submitted", submitted_at: nowIso })
    .eq("id", session.invitationId);

  // Drop the session cookie (keep lang so /submitted renders in the
  // respondent's language). The response is already terminal — getSession
  // returns null once submitted_at is set — so this is hygiene.
  await clearSessionCookie();

  redirect("/submitted");
}
