// app/admin/(protected)/exports/page.tsx
//
// D74 — Pilot Response Export Center. Owner-only (gate mirrors
// /admin/security verbatim).
//
// D84 — Replaced inline Single + Bulk forms with the unified
// ExportModal client component. One trigger button → modal that handles
// shape (long | wide) + scope (single | bulk) + format (csv | xlsx) +
// filters (category, nationality, language) in one place. The download
// route contract is unchanged — modal builds the same /admin/exports/
// download URL with the appropriate query params.
//
// EMPTY STATE: when no responses are submitted yet, the trigger button
// is hidden and an explanatory card renders instead.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listResponses } from "@/lib/repos/responses";
import { listInvitations, categoryLabel } from "@/lib/repos/invitations";
import ExportModal from "@/components/ExportModal";

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
  // most likely want the freshest one). D84 — submittedAt formatted
  // server-side to a stable label string the client modal can render
  // without locale-divergence (server vs browser Intl differences).
  const options = submitted
    .map((r) => {
      const inv = invById.get(r.invitationId);
      return {
        responseId: r.id,
        refCode: inv?.refCode ?? "—",
        categoryLbl: inv ? categoryLabel(inv.category) : "—",
        submittedAt: r.submittedAt,
        submittedAtLabel: fmtDateTime(r.submittedAt),
      };
    })
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  // Shape adapter for the modal — strip the raw timestamp, keep the
  // formatted label only.
  const modalOptions = options.map((o) => ({
    responseId: o.responseId,
    refCode: o.refCode,
    categoryLbl: o.categoryLbl,
    submittedAtLabel: o.submittedAtLabel,
  }));

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
            {/* D84 — Unified Export modal trigger. Replaces the prior
                inline Single + Bulk forms with one button that opens a
                modal handling shape (long | wide), scope (single |
                bulk), format (csv | xlsx), and filters (category +
                nationality + language). */}
            <section className="card p-6">
              <h2 className="text-[16px] font-semibold text-ink mb-1">
                Export Pilot Responses
              </h2>
              <p className="text-[13px] text-muted mb-4">
                ATLAS.ti Wide-format is the default — one row per
                respondent, one column per question, ready for
                <span className="mono"> Import &gt; Survey</span> in
                ATLAS.ti. An ATLAS.ti Desktop variant is also available:
                bare Q/F code column headers + a codebook companion file
                that populates code comments with the full question text
                (downloads as a single ZIP). Long-format (D74) is
                preserved for stats software and supervisor review with
                PII.
              </p>
              <ExportModal options={modalOptions} />
              <p className="text-[12px] text-muted mt-4">
                Long-format export decrypts recipient name + email for
                analytical use. Wide-format excludes PII (ref_code is the
                ATLAS.ti document handle). Every download is audited
                (action <span className="mono">export.responses</span>,
                metadata includes shape + filters). Token and access-code
                secrets are never exported.{" "}
                <Link
                  className="text-brand-700 underline"
                  href="/admin/security"
                >
                  View audit log →
                </Link>
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
