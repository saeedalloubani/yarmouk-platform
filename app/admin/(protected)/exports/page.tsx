// app/admin/(protected)/exports/page.tsx
//
// D74 — Pilot Response Export Center. Owner-only (gate mirrors
// /admin/security verbatim).
//
// Two export paths:
//   - Single response: pick from a list of submitted+active responses
//   - Bulk: all submitted+active responses, long-format
// Each path offers CSV (UTF-8 with BOM) or XLSX. The actual download is
// handled by app/admin/(protected)/exports/download/route.ts; the form
// submits there with GET so the browser's download UX is the carrier.
//
// EMPTY STATE: when no responses are submitted yet, both sections are
// hidden and an explanatory card renders instead. (Bulk export still
// works server-side for testing, but there's no UI button until at
// least one response exists.)

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listResponses } from "@/lib/repos/responses";
import { listInvitations, categoryLabel } from "@/lib/repos/invitations";

export const dynamic = "force-dynamic";

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

export default async function ExportsPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // exports are owner-only

  // Submitted + active responses only (matches D63 cross-cutting analytical
  // filter). hideWithdrawn=true filters status='withdrawn' at the repo;
  // submitted_at filter is applied in-memory because listResponses returns
  // submitted+unsubmitted alike for the list view.
  const allResponses = await listResponses(supabase, { hideWithdrawn: true });
  const submitted = allResponses.filter((r) => r.submittedAt !== null);

  // Companion invitation data for the dropdown labels (ref_code + category).
  // We don't decrypt PII here — only label fields. Owner branch hits the
  // base table (covering us for any future column add).
  const invitations =
    submitted.length === 0 ? [] : await listInvitations(supabase, {});
  const invById = new Map(invitations.map((i) => [i.id, i] as const));

  // Single-response options — sorted newest-submitted first (Sura will
  // most likely want the freshest one).
  const options = submitted
    .map((r) => {
      const inv = invById.get(r.invitationId);
      return {
        responseId: r.id,
        refCode: inv?.refCode ?? "—",
        categoryLbl: inv ? categoryLabel(inv.category) : "—",
        submittedAt: r.submittedAt,
      };
    })
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  const totalSubmitted = submitted.length;

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Pilot Response Export
          </h1>
          <p className="text-[13px] text-muted mt-1">
            {totalSubmitted === 0
              ? "No responses submitted yet. Export will be available once participants complete the questionnaire."
              : `${totalSubmitted} submitted ${
                  totalSubmitted === 1 ? "response" : "responses"
                } available`}
          </p>
        </div>

        {totalSubmitted === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            Nothing to export yet.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Section 1 — Single response */}
            <section className="card p-6">
              <h2 className="text-[16px] font-semibold text-ink mb-1">
                Single Response Export
              </h2>
              <p className="text-[13px] text-muted mb-4">
                Export one response as a long-format file (1 row per question).
              </p>
              <form
                method="GET"
                action="/admin/exports/download"
                target="_blank"
                className="space-y-4"
              >
                <input type="hidden" name="scope" value="single" />
                <div>
                  <label
                    htmlFor="responseId"
                    className="block text-[12px] font-semibold text-ink mb-1"
                  >
                    Response
                  </label>
                  <select
                    id="responseId"
                    name="responseId"
                    required
                    defaultValue=""
                    className="w-full border border-line rounded-md px-3 py-2 text-[13px] bg-white"
                  >
                    <option value="" disabled>
                      Choose a response…
                    </option>
                    {options.map((o) => (
                      <option key={o.responseId} value={o.responseId}>
                        {o.refCode} — {o.categoryLbl} · submitted{" "}
                        {fmtDateTime(o.submittedAt)}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset>
                  <legend className="block text-[12px] font-semibold text-ink mb-1">
                    Format
                  </legend>
                  <label className="inline-flex items-center gap-1.5 me-4 text-[13px]">
                    <input
                      type="radio"
                      name="format"
                      value="csv"
                      defaultChecked
                    />
                    CSV (UTF-8 with BOM)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[13px]">
                    <input type="radio" name="format" value="xlsx" />
                    XLSX
                  </label>
                </fieldset>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700"
                >
                  Download
                </button>
              </form>
            </section>

            {/* Section 2 — Bulk */}
            <section className="card p-6">
              <h2 className="text-[16px] font-semibold text-ink mb-1">
                Bulk Export (All Submitted)
              </h2>
              <p className="text-[13px] text-muted mb-4">
                Export every submitted+active response in one long-format file.
                Withdrawn responses are excluded.
              </p>
              <form
                method="GET"
                action="/admin/exports/download"
                target="_blank"
                className="space-y-4"
              >
                <input type="hidden" name="scope" value="bulk" />
                <fieldset>
                  <legend className="block text-[12px] font-semibold text-ink mb-1">
                    Format
                  </legend>
                  <label className="inline-flex items-center gap-1.5 me-4 text-[13px]">
                    <input
                      type="radio"
                      name="format"
                      value="csv"
                      defaultChecked
                    />
                    CSV (UTF-8 with BOM)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[13px]">
                    <input type="radio" name="format" value="xlsx" />
                    XLSX
                  </label>
                </fieldset>
                <p className="text-[12px] text-muted">
                  {totalSubmitted}{" "}
                  {totalSubmitted === 1 ? "response" : "responses"} · long
                  format (1 row per question per response)
                </p>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700"
                >
                  Download bulk export
                </button>
              </form>
            </section>

            <p className="text-[12px] text-muted">
              Export decrypts recipient name + email for analytical use. Every
              download is audited (action{" "}
              <span className="mono">export.responses</span>). Token and
              access-code secrets are never exported.{" "}
              <Link
                className="text-brand-700 underline"
                href="/admin/security"
              >
                View audit log →
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
