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
import { notifyOwnersOfSubmission } from "@/lib/notifications";

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

// ---- saveChoiceAnswer (autosave for single/multi_choice) ----
// The choice-question analogue of saveAnswer. Session-derived IDs (never
// client args); the save_choice_answer RPC is the trust boundary (re-validates
// writable + question-on-version + every option-belongs + single<=1, and
// writes the answer row + replaces its answer_options atomically). We add the
// nationality visible-set guard here because the RPC checks version membership
// but not nationality (a Jordanian must not answer a Syrian-only question).
// The free_text saveAnswer path above is untouched.
export async function saveChoiceAnswer(
  questionId: string,
  optionIds: string[],
  comment: string | null
): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };

  const admin = createSupabaseAdminClient();

  // Defense: question must be in this respondent's visible set (nationality)
  // and must be a choice type. The RPC enforces the rest server-side.
  const visible = await getVisibleQuestions(
    admin,
    session.questionnaireVersionId,
    session.nationality
  );
  const q = visible.find((v) => v.id === questionId);
  if (!q || q.answerType === "free_text") return { ok: false };

  // Normalize an empty/whitespace comment to "no comment" (DB NULL via the
  // RPC's DEFAULT — omitting the param). A real comment is stored verbatim.
  const commentArg =
    comment && comment.trim().length > 0 ? comment : undefined;

  const { error: rpcErr } = await admin.rpc("save_choice_answer", {
    p_response_id: session.responseId,
    p_question_id: questionId,
    p_option_ids: optionIds,
    p_comment: commentArg,
  });
  if (rpcErr) {
    console.error("[answers] save_choice_answer failed", rpcErr);
    return { ok: false };
  }

  // opened→started flip — same idempotent, non-fatal flip as saveAnswer.
  const { error: statusErr } = await admin
    .from("invitations")
    .update({ status: "started", started_at: new Date().toISOString() })
    .eq("id", session.invitationId)
    .eq("status", "opened");
  if (statusErr) {
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

  // Type-aware satisfaction (D103): free_text → text non-empty; choice → >=1
  // selection; allow_skip → satisfied. Pass the visible metadata so the gate
  // branches per type (a choice answer's answer_text is '' and would never
  // count under the old text-only rule).
  const answered = await getAnsweredQuestionIds(
    admin,
    session.responseId,
    visible
  );

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

  // Best-effort owner notification (in-app + email). FIRE-AND-FORGET:
  // notifyOwnersOfSubmission NEVER throws — it wraps every step and only
  // logs. We await it (serverless can't reliably detach background work),
  // but a failure here can't roll back the submit or block the redirect.
  // Placed BEFORE redirect() on purpose, and deliberately NOT inside a try
  // that wraps the redirect — redirect() works by throwing NEXT_REDIRECT,
  // which must propagate. The respondent reaches /submitted regardless.
  await notifyOwnersOfSubmission(admin, {
    invitationId: session.invitationId,
    responseId: session.responseId,
  });

  // Drop the session cookie (keep lang so /submitted renders in the
  // respondent's language). The response is already terminal — getSession
  // returns null once submitted_at is set — so this is hygiene.
  await clearSessionCookie();

  redirect("/submitted");
}
