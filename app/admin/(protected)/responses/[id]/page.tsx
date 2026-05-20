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
import { getResponse, getAnswersForResponse } from "@/lib/repos/responses";
import { getInvitation } from "@/lib/repos/invitations";
import { getConsentForResponse } from "@/lib/repos/consent";
import { getVisibleQuestions } from "@/lib/repos/questions";

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
  const answers = await getAnswersForResponse(supabase, response.id);

  const answeredCount = [...answers.values()].filter(
    (a) => a.answerText.trim().length > 0
  ).length;
  const totalWords = [...answers.values()].reduce(
    (sum, a) => sum + a.wordCount,
    0
  );

  const refCode = invitation?.refCode ?? "—";
  const isReadonly = admin.role === "readonly"; // BANNER ONLY — not a data gate.

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
              <dd className="text-ink capitalize">
                {invitation?.category ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted mb-0.5">Nationality</dt>
              <dd className="text-ink capitalize">
                {invitation?.nationality ?? "—"}
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
                {response.durationMinutes != null
                  ? `${response.durationMinutes} min`
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

        {/* Answers */}
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold text-ink mb-4">Answers</h2>
          {questions.length === 0 ? (
            <p className="text-[13px] text-muted">No questions to show.</p>
          ) : (
            <ol className="space-y-5">
              {questions.map((q) => {
                const a = answers.get(q.id);
                const answerText = (a?.answerText ?? "").trim();
                const questionText = lang === "ar" ? q.textAr : q.textEn;
                return (
                  <li key={q.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span className="mono text-[11px] font-semibold text-brand-700">
                        {q.code}
                      </span>
                      {q.isFeedback && (
                        <span className="chip-solid bg-brand-50 text-brand-700">
                          feedback
                        </span>
                      )}
                    </div>
                    <p
                      className="text-[13px] font-medium text-ink mb-2"
                      dir={lang === "ar" ? "rtl" : "ltr"}
                    >
                      {questionText}
                    </p>
                    {answerText ? (
                      <p
                        className="text-[13px] text-ink/90 whitespace-pre-wrap"
                        dir={lang === "ar" ? "rtl" : "ltr"}
                      >
                        {answerText}
                      </p>
                    ) : (
                      <p className="text-[13px] text-muted italic">
                        (not answered)
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
