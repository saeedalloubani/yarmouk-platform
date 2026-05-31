// app/admin/(protected)/responses/page.tsx
//
// Responses list (3c-i) — visible to BOTH owner and readonly. The list is
// deliberately IDENTITY-FREE: keyed by ref_code, never recipient name. So
// it needs NO redaction branch at all — every column shown (ref_code,
// category, nationality, status) is non-PII and identical for both roles.
//
// The PII boundary lives only on the detail page. Here, invitation context
// is fetched through the role-branching invitations repo and joined in
// memory by invitation_id — NOT via a PostgREST embed, which would hit the
// invitations base table and leak ciphertext PII to readonly admins.
//
// Two STATUS dimensions are now relevant:
//   - invitation.status (sent / opened / started / submitted / revoked) —
//     the historical "Status" column display, denormalized from the
//     role-branching invitations repo. Unchanged.
//   - response.status (active / withdrawn, post-D63) — soft-delete
//     lifecycle on the response itself. Rendered as an ADDITIONAL chip
//     next to the invitation status when withdrawn (visible to both
//     roles; status is non-PII). Default-hidden via the ?withdrawn=show
//     toggle so the list shows research-relevant data by default; Sura
//     opts in when auditing.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInvitations, categoryLabel } from "@/lib/repos/invitations";
import { listResponses, getAnswerCounts } from "@/lib/repos/responses";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ withdrawn?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  // Default-OFF: the list hides withdrawn rows unless ?withdrawn=show.
  // Filter is applied at the QUERY layer (listResponses passes the flag
  // to PostgREST), not in-memory — D63 cross-cutting filter discipline:
  // when filtering, do it at the read so we never load rows we won't
  // render. The MUST-RETAIN classification only means the REPO doesn't
  // bake the filter in; the PAGE can opt in.
  const { withdrawn } = await searchParams;
  const showWithdrawn = withdrawn === "show";

  const responses = await listResponses(supabase, {
    hideWithdrawn: !showWithdrawn,
  });

  // Invitation context via the role-branching repo (NOT an embed). ref_code,
  // category, nationality, status are non-PII — present and identical on both
  // the base table and invitations_redacted.
  const invitations = await listInvitations(supabase);
  const invMap = new Map(invitations.map((i) => [i.id, i]));

  // Non-empty answer counts, one query, joined in memory.
  const counts = await getAnswerCounts(
    supabase,
    responses.map((r) => r.id)
  );

  const rows = responses.map((r) => {
    const inv = invMap.get(r.invitationId);
    return {
      id: r.id,
      refCode: inv?.refCode ?? "—",
      category: inv?.category ?? null,
      nationality: inv?.nationality ?? null,
      status: inv?.status ?? null,
      collectionMode: inv?.collectionMode ?? null,
      language: r.language,
      startedAt: r.startedAt,
      submittedAt: r.submittedAt,
      durationMinutes: r.durationMinutes,
      answerCount: counts.get(r.id) ?? 0,
      responseStatus: r.status,
    };
  });

  // Submitted first (most-recent submission on top), then in-progress by
  // most-recent start.
  rows.sort((a, b) => {
    if (a.submittedAt && b.submittedAt)
      return b.submittedAt.localeCompare(a.submittedAt);
    if (a.submittedAt) return -1;
    if (b.submittedAt) return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="eyebrow mb-1">Admin</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              Responses
            </h1>
            <p className="text-[13px] text-muted mt-1">
              {rows.length} {showWithdrawn ? "total" : "active"} · signed in as{" "}
              {admin.name} ({admin.role})
            </p>
          </div>
          {/* Default-OFF withdrawn-hide toggle. Query-string driven so
              the chosen view survives a refresh / can be bookmarked.
              Same chip-link idiom as other admin filters. */}
          <Link
            href={
              showWithdrawn ? "/admin/responses" : "/admin/responses?withdrawn=show"
            }
            className="btn-ghost text-[12px]"
          >
            {showWithdrawn ? "Hide withdrawn" : "Show withdrawn"}
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            No responses yet. They appear once an invitee opens their link.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-bgAlt text-muted">
                <tr className="text-start">
                  <th className="text-start font-semibold px-4 py-2.5">Ref</th>
                  <th className="text-start font-semibold px-4 py-2.5">Category</th>
                  <th className="text-start font-semibold px-4 py-2.5">Nationality</th>
                  <th className="text-start font-semibold px-4 py-2.5">Status</th>
                  <th className="text-start font-semibold px-4 py-2.5">Lang</th>
                  <th className="text-start font-semibold px-4 py-2.5">Answers</th>
                  <th className="text-start font-semibold px-4 py-2.5">Started</th>
                  <th className="text-start font-semibold px-4 py-2.5">Submitted</th>
                  <th className="text-start font-semibold px-4 py-2.5">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-line hover:bg-bgAlt/50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/responses/${row.id}`}
                        className="mono font-semibold text-brand-700 hover:underline"
                      >
                        {row.refCode}
                      </Link>
                      {row.collectionMode === "interview" && (
                        <span className="chip-solid bg-accent-50 text-accent-700 ms-2 text-[10px]">
                          Interview
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{row.category ? categoryLabel(row.category) : "—"}</td>
                    <td className="px-4 py-2.5 capitalize">
                      {row.nationality ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.status ? (
                        <span className="chip-solid bg-brand-50 text-brand-700">
                          {row.status}
                        </span>
                      ) : (
                        "—"
                      )}
                      {/* Withdrawn chip rides alongside invitation
                          status (e.g. "submitted · Withdrawn"). Visible
                          to both roles; appears only when the
                          show-withdrawn toggle is on, since the default
                          query already filtered these out. */}
                      {row.responseStatus === "withdrawn" && (
                        <span className="chip-solid bg-dangerLight text-danger ms-2">
                          Withdrawn
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 uppercase mono">{row.language}</td>
                    <td className="px-4 py-2.5 mono">{row.answerCount}</td>
                    <td className="px-4 py-2.5">{fmtDate(row.startedAt)}</td>
                    <td className="px-4 py-2.5">{fmtDate(row.submittedAt)}</td>
                    <td className="px-4 py-2.5">
                      {row.durationMinutes != null
                        ? `${row.durationMinutes} min`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
