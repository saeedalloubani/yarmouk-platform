// app/admin/(protected)/analytics/feedback/page.tsx
//
// Pilot-Feedback Hub — the F1–F4 feedback block (D9), grouped by question with
// each submitted respondent's answer. BOTH ROLES: feedback is non-PII research
// data (shown by ref_code, never name/email), so no owner gate — same access
// model as Responses. Renders its empty state until pilot respondents submit.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getPilotFeedback, type FeedbackQuestion } from "@/lib/repos/feedback";
import { categoryLabel } from "@/lib/repos/invitations";

export const dynamic = "force-dynamic";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function FeedbackPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  const questions = await getPilotFeedback(supabase);
  const totalAnswers = questions.reduce((s, q) => s + q.answers.length, 0);

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Analytics</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Pilot Feedback
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Respondents&apos; answers to the F1–F4 pilot feedback block —
            submitted responses only.
            {totalAnswers > 0 && <> · {totalAnswers} answers</>}
          </p>
        </div>

        {totalAnswers === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            No pilot feedback yet — responses appear here once pilot respondents
            submit.
          </div>
        ) : (
          <div className="space-y-6">
            {questions.map((q) => (
              <FeedbackSection key={q.questionCode} q={q} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function FeedbackSection({ q }: { q: FeedbackQuestion }) {
  const n = q.answers.length;
  return (
    <section className="card p-6">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="mono text-[12px] font-bold text-brand-700">
          {q.questionCode}
        </span>
        <span className="text-[11px] text-muted">
          {n} response{n === 1 ? "" : "s"}
        </span>
      </div>
      <h2 className="text-[15px] font-semibold text-ink">{q.textEn}</h2>
      {q.textAr && (
        <p className="text-[13px] text-muted mt-0.5" dir="rtl">
          {q.textAr}
        </p>
      )}

      {n === 0 ? (
        <p className="text-[13px] text-muted mt-4">
          No responses to this question yet.
        </p>
      ) : (
        <ul className="mt-4">
          {q.answers.map((a, i) => (
            <li key={i} className="border-t border-line py-3 first:border-t-0">
              <p
                className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap"
                dir="auto"
              >
                {a.answerText}
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
                <span className="text-muted-faint">· {fmtWhen(a.submittedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
