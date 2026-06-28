// app/admin/(protected)/responses/[id]/page.tsx
//
// Response detail (3c-i) — the first place the PII-redaction boundary
// becomes user-facing. Visible to BOTH owner and readonly:
//   - Answers (question text + answer text) = research DATA → both roles
//     see the full text. Redaction is about WHO the respondent is, not
//     WHAT they answered.
//   - Recipient name/email + consent signed-name = IDENTITY → owner sees
//     decrypted plaintext; readonly sees "Redacted".
//
// THE LOAD-BEARING PROPERTY (read this hardest): redaction is NULL-DRIVEN,
// not role-driven. The invitations/consent repos route owner→base (ciphertext)
// and readonly→redacted-view (NULL) via current_admin_role(). This page only
// asks "did I get ciphertext or null?" — there is ZERO `if (role === 'owner')`
// in the redaction path. That's why flipping the admin row to readonly in SQL
// flips this page's behavior with no code change.
//
// BANNER INDEPENDENCE: `admin.role` is read for exactly ONE thing — whether
// to render the cosmetic "viewing as readonly" banner. It never gates which
// data renders. The redacted values below are computed purely from repo
// null-ness; deleting the banner would not change a single character of them.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getResponse,
  computeActiveDurationMinutes,
} from "@/lib/repos/responses";
import {
  getRichAnswers,
  richAnswerIsAnswered,
  type RichAnswer,
} from "@/lib/repos/answers";
import { getInvitation, categoryLabel, collectionModeLabel } from "@/lib/repos/invitations";
import { getConsentForResponse } from "@/lib/repos/consent";
import { getVisibleQuestions } from "@/lib/repos/questions";
import { listTagsForResponse, listAllTags } from "@/lib/repos/tags";
import { getResearcherNote } from "@/lib/repos/notes";
import { listRecordings } from "@/lib/repos/recordings";
import ResponseTagEditor from "@/components/ResponseTagEditor";
import ResearcherNoteEditor from "@/components/ResearcherNoteEditor";
import RecordingsSection from "@/components/RecordingsSection";
import WithdrawResponseButton from "@/components/WithdrawResponseButton";

export const dynamic = "force-dynamic";

// Sentinel for a redacted identity field. The repo returned NULL (readonly),
// so there is no ciphertext to decrypt — render this instead.
const REDACTED = "__REDACTED__";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Decrypt a ciphertext PII column for the OWNER path. Only ever called when
 * the repo returned non-null ciphertext (owner). On Vault/key failure we log
 * and return a placeholder rather than crashing the whole page — a decrypt
 * failure is a key-access incident (see RUNBOOK "Reading invitation-send
 * failures" / "Disaster recovery"), but the answers must still render.
 */
async function decryptPii(
  supabase: SupabaseClient<Database>,
  ciphertext: string
): Promise<string> {
  const { data, error } = await supabase.rpc("decrypt_pii", {
    p_ciphertext: ciphertext,
  });
  if (error || data == null) {
    console.error("[responses] decrypt_pii failed", error?.message);
    return "(unavailable — see server log)";
  }
  return data;
}

/** Render an identity field: the value, or a "Redacted" chip when masked. */
function IdentityValue({ value }: { value: string }) {
  if (value === REDACTED) {
    return <span className="chip-solid bg-warnLight text-warn">Redacted</span>;
  }
  return <span className="text-ink">{value}</span>;
}

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  const response = await getResponse(supabase, id);
  if (!response) notFound();

  // PII context via the role-branching repos. Owner → ciphertext; readonly →
  // NULL (redacted view). NEVER an embed (that would hit the base table).
  const invitation = await getInvitation(supabase, response.invitationId);
  const consent = await getConsentForResponse(supabase, response.id);

  // ---- NULL-DRIVEN REDACTION (Piece A) ----------------------------------
  // These depend ONLY on what the repos returned (ciphertext vs NULL). They
  // never read admin.role. Do not add a role check here.
  const recipientName = invitation?.recipientNameEncrypted
    ? await decryptPii(supabase, invitation.recipientNameEncrypted)
    : REDACTED;
  const recipientEmail = invitation?.recipientEmailEncrypted
    ? await decryptPii(supabase, invitation.recipientEmailEncrypted)
    : REDACTED;
  const consentName = consent?.signedNameEncrypted
    ? await decryptPii(supabase, consent.signedNameEncrypted)
    : REDACTED;
  // -----------------------------------------------------------------------

  const lang: "en" | "ar" = response.language === "ar" ? "ar" : "en";

  // Answers (identical for both roles). Use the respondent's nationality-
  // filtered question set (D32) so a Jordanian's detail doesn't list
  // Syria-only questions as falsely "(not answered)".
  const questions = invitation
    ? await getVisibleQuestions(
        supabase,
        invitation.questionnaireVersionId,
        invitation.nationality
      )
    : [];
  // D106 — choice-aware read via the shared keystone. answers maps
  // question_id → RichAnswer (free_text body, choice selections WITH labels,
  // comment, word_count). Pre-D106 this read answer_text only, so choice
  // answers rendered "(no answer)" and didn't count as answered.
  const richByResponse = await getRichAnswers(supabase, [response.id]);
  const answers =
    richByResponse.get(response.id) ?? new Map<string, RichAnswer>();

  // Answered count — TYPE-AWARE (shared predicate): free_text → non-empty
  // text; choice → ≥1 selection. Total words stays from the generated
  // word_count (a choice answer honestly contributes 0 prose words).
  const answeredCount = [...answers.values()].filter(
    richAnswerIsAnswered
  ).length;
  const totalWords = [...answers.values()].reduce(
    (sum, a) => sum + a.wordCount,
    0
  );

  // D82 — ACTIVE engagement duration (first-answer-save → submit). Start
  // milestone sourced from invitations.started_at (set guard-once by
  // saveAnswer); end from response.submittedAt. Replaces the D81 Item 2
  // fallback that used responses.started_at (consent moment) and
  // produced misleading 48-hour values. Used by both the Response
  // metadata block (Duration field) and the Reader summary footer
  // (Engagement time field) below — single computation, two consumers,
  // identical value by construction.
  const activeDurationMinutes = computeActiveDurationMinutes(
    invitation?.startedAt ?? null,
    response.submittedAt
  );

  const refCode = invitation?.refCode ?? "—";
  const isReadonly = admin.role === "readonly"; // BANNER ONLY — not a data gate.
  const isOwner = admin.role === "owner";

  // ---- ANNOTATION LAYER (3c-ii) -----------------------------------------
  // Tags: applied codes are visible to BOTH roles (RLS admits readonly
  // SELECT on tags/response_tags). The owner's datalist of all tag names is
  // fetched only on the owner branch — readonly never gets the add control.
  const appliedTags = await listTagsForResponse(supabase, response.id);
  const allTags = isOwner ? await listAllTags(supabase) : [];

  // Researcher note: OWNER-ONLY FEATURE — fetched ONLY on the owner branch
  // (not a redaction; absent for readonly). This is a legitimate role gate,
  // distinct from the null-driven identity-redaction path above. RLS
  // (rn_owner_select, migration 16) also returns nothing to readonly, so the
  // note body never reaches a supervisor by any path.
  const researcherNote = isOwner
    ? await getResearcherNote(supabase, response.id)
    : null;

  // Recordings — OWNER-ONLY, fetched on the owner branch only (like the
  // researcher note: absent for readonly, not redacted). The list passed to
  // the client carries NO storage path — playback signs a URL lazily server-
  // side via getRecordingPlaybackUrlAction.
  const recordings = isOwner
    ? await listRecordings(supabase, { responseId: response.id })
    : [];
  // -----------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Back + header */}
        <div className="mb-6">
          <Link
            href="/admin/responses"
            className="btn-ghost text-[13px] mb-4 inline-block"
          >
            ← Responses
          </Link>
          <div className="eyebrow mb-1">Response</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            <span className="mono text-brand-700">{refCode}</span>
            {/* Withdrawal status badge — visible to BOTH roles (status
                is non-PII; the marker tells supervisors this row is
                excluded from analytics/exports). Same chip idiom as
                invitations list's revoked badge. */}
            {response.status === "withdrawn" && (
              <span className="chip-solid bg-dangerLight text-danger ms-3 text-[12px] align-middle">
                Withdrawn
              </span>
            )}
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Signed in as {admin.name} ({admin.role})
          </p>
        </div>

        {/* Cosmetic readonly banner — independent of the redaction path above. */}
        {isReadonly && (
          <div className="notice-info mb-6">
            <span>
              You are viewing as a read-only supervisor. Respondent identity
              (name, email, consent signature) is redacted; the responses
              themselves are shown in full.
            </span>
          </div>
        )}

        {/* Invitation / identity context */}
        <section className="card p-5 mb-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">
            Invitation
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <dt className="text-muted mb-0.5">Ref code</dt>
              <dd className="mono text-ink">{refCode}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Category</dt>
              <dd className="text-ink">
                {invitation?.category ? categoryLabel(invitation.category) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Nationality</dt>
              <dd className="text-ink capitalize">
                {invitation?.nationality ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Collection mode</dt>
              <dd className="text-ink">
                {invitation ? collectionModeLabel(invitation.collectionMode) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Status</dt>
              <dd className="text-ink">{invitation?.status ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Recipient name</dt>
              <dd>
                <IdentityValue value={recipientName} />
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Recipient email</dt>
              <dd>
                <IdentityValue value={recipientEmail} />
              </dd>
            </div>
          </dl>
        </section>

        {/* Response metadata */}
        <section className="card p-5 mb-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Response</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <dt className="text-muted mb-0.5">Language</dt>
              <dd className="text-ink uppercase mono">{response.language}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Duration</dt>
              <dd className="text-ink">
                {activeDurationMinutes != null
                  ? `${activeDurationMinutes} min`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Started</dt>
              <dd className="text-ink">{fmtDateTime(response.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Submitted</dt>
              <dd className="text-ink">{fmtDateTime(response.submittedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Answered</dt>
              <dd className="text-ink mono">
                {answeredCount} / {questions.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Total words</dt>
              <dd className="text-ink mono">{totalWords}</dd>
            </div>
          </dl>
        </section>

        {/* Consent verification */}
        <section className="card p-5 mb-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Consent</h2>
          {consent ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <div>
                <dt className="text-muted mb-0.5">Agreed to participate</dt>
                <dd className="text-ink">
                  {consent.agreedToParticipate ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-muted mb-0.5">Agreed to read</dt>
                <dd className="text-ink">
                  {consent.agreedToRead ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-muted mb-0.5">Audio consent</dt>
                <dd className="text-ink">
                  {consent.audioConsent ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-muted mb-0.5">Signed at</dt>
                <dd className="text-ink">{fmtDateTime(consent.signedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted mb-0.5">Consent version</dt>
                <dd className="text-ink mono">{consent.consentTextVersion}</dd>
              </div>
              <div>
                <dt className="text-muted mb-0.5">Signed name</dt>
                <dd>
                  <IdentityValue value={consentName} />
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-muted">No consent record.</p>
          )}
        </section>

        {/* Withdrawal — OWNER-ONLY section, only meaningful for a
            submitted response (in-progress responses get the wrong-tool
            error via the action's not_submitted gate). Status-aware
            render:
              - status='active'    → explanation + WithdrawResponseButton
              - status='withdrawn' → withdrawn timestamp + audit pointer
            The header badge above makes the withdrawn state visible to
            readonly supervisors too; this owner-only card is where the
            action lives. */}
        {isOwner && response.submittedAt && (
          <section className="card p-5 mb-5">
            <h2 className="text-[15px] font-semibold text-ink mb-3">
              Withdrawal
            </h2>
            {response.status === "withdrawn" ? (
              <div className="text-[13px] text-ink">
                <p>
                  Withdrawn at{" "}
                  <span className="mono">
                    {fmtDateTime(response.withdrawnAt)}
                  </span>
                </p>
                <p className="text-[12px] text-muted mt-1">
                  (audit log records the action)
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[13px] text-muted mb-3">
                  Remove this response from research data. Soft-deletes
                  the response: the consent record is retained as audit
                  proof, but the row is excluded from exports, ATLAS.ti,
                  and analytics. The action is logged at alert severity.
                </p>
                <WithdrawResponseButton
                  responseId={response.id}
                  refCode={refCode}
                />
              </div>
            )}
          </section>
        )}

        {/* Answers — thesis-friendly reader (D79 Feature 2).
            Each block shows BOTH languages of the question (the participant
            answered against one but the thesis quotes both), followed by the
            participant's answer in a punchier treatment so it reads cleanly
            for copy-paste into thesis prose. The answer's `dir` matches the
            respondent's language (response.language), which is what they
            actually wrote in; `whitespace-pre-line` preserves their
            paragraph breaks without forcing the long-line wrap of pre-wrap. */}
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold text-ink mb-4">Answers</h2>
          {questions.length === 0 ? (
            <p className="text-[13px] text-muted">No questions to show.</p>
          ) : (
            <ol className="space-y-6">
              {questions.map((q) => {
                const a = answers.get(q.id);
                const answerText = (a?.text ?? "").trim();
                // D106 — branch on the QUESTION's type (answers carry no type).
                const isChoice = q.answerType !== "free_text";
                const selected = a?.selectedOptions ?? [];
                const comment = (a?.comment ?? "").trim();
                return (
                  <li
                    key={q.id}
                    className="border-b border-line pb-5 last:border-0 last:pb-0"
                  >
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="mono text-[11px] font-semibold text-brand-700">
                        {q.code}
                      </span>
                      {q.isFeedback && (
                        <span className="chip-solid bg-brand-50 text-brand-700">
                          feedback
                        </span>
                      )}
                    </div>
                    {/* Bilingual question display. EN above, AR below; both
                        muted/prose, neither dominant — the answer is the
                        primary surface beneath them. */}
                    <p
                      className="text-[13px] text-muted leading-relaxed mb-1"
                      dir="ltr"
                    >
                      {q.textEn}
                    </p>
                    <p
                      className="text-[13px] text-muted leading-relaxed mb-3"
                      dir="rtl"
                    >
                      {q.textAr}
                    </p>
                    {/* D106 — FREE_TEXT path is byte-identical to pre-D106:
                        the participant's answer, bumped to text-[15px] + full
                        text-ink + whitespace-pre-line for thesis-readable
                        treatment. pre-line preserves paragraph breaks but
                        collapses run-on whitespace, which reads better than
                        pre-wrap's full preservation. */}
                    {!isChoice ? (
                      answerText ? (
                        <p
                          className="text-[15px] text-ink leading-relaxed whitespace-pre-line"
                          dir={lang === "ar" ? "rtl" : "ltr"}
                        >
                          {answerText}
                        </p>
                      ) : (
                        <p className="text-[13px] text-muted italic">
                          (no answer)
                        </p>
                      )
                    ) : selected.length > 0 || comment ? (
                      /* CHOICE — selected option label(s) in the respondent's
                         language as chips (mirrors the wizard), then the
                         comment in its own sub-block when present. */
                      <div>
                        {selected.length > 0 ? (
                          <ul
                            className="flex flex-wrap gap-2"
                            dir={lang === "ar" ? "rtl" : "ltr"}
                          >
                            {selected.map((o) => (
                              <li
                                key={o.id}
                                className="chip-solid bg-brand-50 text-brand-700 text-[14px]"
                              >
                                <span
                                  className={
                                    lang === "ar" ? "font-arabic" : undefined
                                  }
                                >
                                  {lang === "ar" ? o.labelAr : o.labelEn}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[13px] text-muted italic">
                            (no selection)
                          </p>
                        )}
                        {comment && (
                          <div className="mt-2.5">
                            <div className="eyebrow mb-0.5">Comment</div>
                            <p
                              className="text-[14px] text-ink leading-relaxed whitespace-pre-line"
                              dir={lang === "ar" ? "rtl" : "ltr"}
                            >
                              {comment}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[13px] text-muted italic">
                        (no answer)
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* D79 Feature 2 footer — engagement summary + analytical-pipeline
            link. Sura's loop: read the response → export to ATLAS.ti.
            The export center is the next-action surface. */}
        <section className="card p-5 mt-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">
            Reader summary
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] mb-4">
            <div>
              <dt className="text-muted mb-0.5">Answered questions</dt>
              <dd className="text-ink mono">
                {answeredCount} / {questions.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Total words</dt>
              <dd className="text-ink mono">{totalWords}</dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Engagement time</dt>
              <dd className="text-ink">
                {activeDurationMinutes != null
                  ? `${activeDurationMinutes} min`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Language</dt>
              <dd className="text-ink uppercase mono">{response.language}</dd>
            </div>
          </dl>
          <Link href="/admin/exports" className="btn-ghost text-[12px]">
            Export responses →
          </Link>
        </section>

        {/* Tags — applied qualitative codes (3c-ii). Both roles see the
            chips; only the owner gets the add form + remove controls
            (canEdit). The server action + RLS enforce the write boundary
            independently of canEdit.

            D81 Item 5 — inline help text below the header so Sura (and
            future readonly supervisors) understand what tags are for
            without leaving the page. Persistent UI explanation; mirrors
            the "Researcher notes" section's short help line treatment. */}
        <section className="card p-5 mt-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Tags</h2>
          <p className="text-[12px] text-muted mb-3">
            Qualitative codes for thematic categorization — useful for
            ATLAS.ti pre-coding. Apply themes like &ldquo;water_quality&rdquo;
            or &ldquo;transboundary_cooperation&rdquo; to organize responses
            analytically. (Not exported to .xlsx by default.)
          </p>
          <ResponseTagEditor
            responseId={response.id}
            initialTags={appliedTags.map((t) => ({
              id: t.id,
              name: t.name,
              category: t.category,
            }))}
            allTagNames={allTags.map((t) => t.name)}
            canEdit={isOwner}
          />
        </section>

        {/* Researcher notes — OWNER ONLY. Rendered only on the owner branch,
            so it's never sent to a readonly supervisor's browser (absent, not
            redacted). */}
        {isOwner && (
          <section className="card p-5 mt-5">
            <h2 className="text-[15px] font-semibold text-ink mb-3">
              Researcher notes
            </h2>
            <p className="text-[12px] text-muted mb-3">
              Private working notes — visible only to you (the owner), never to
              read-only supervisors.
            </p>
            <ResearcherNoteEditor
              responseId={response.id}
              initialNote={researcherNote?.noteText ?? ""}
            />
          </section>
        )}

        {/* Recordings — OWNER ONLY, and only when audio was consented. The
            consent gate here mirrors the upload action + DB trigger
            (migration 018): no audio surface at all unless audioConsent ===
            true. When consent was explicitly declined we show a muted note;
            when there is no consent record yet we render nothing (the Consent
            section above already states "No consent record"). */}
        {isOwner && consent?.audioConsent === true && (
          <section className="card p-5 mt-5">
            <h2 className="text-[15px] font-semibold text-ink mb-3">
              Recordings
            </h2>
            <p className="text-[12px] text-muted mb-3">
              Interview audio — owner only. Read-only supervisors never have
              audio access.
            </p>
            <RecordingsSection
              responseId={response.id}
              initialRecordings={recordings.map((r) => ({
                id: r.id,
                filename: r.audioFilename,
                sizeBytes: r.audioSizeBytes,
                uploadedAt: r.uploadedAt,
              }))}
            />
          </section>
        )}

        {isOwner && consent && consent.audioConsent === false && (
          <section className="card p-5 mt-5">
            <h2 className="text-[15px] font-semibold text-ink mb-3">
              Recordings
            </h2>
            <p className="text-[13px] text-muted">
              Audio recording was not consented for this response.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
