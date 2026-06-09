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
import {
  listResponses,
  getAnswerCounts,
  computeActiveDurationMinutes,
} from "@/lib/repos/responses";
import ScopeFilter from "@/components/ScopeFilter";
import VariantChip from "@/components/VariantChip";
import { resolveOverviewScope, SCOPE_LABEL } from "@/lib/repos/scope";

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
  searchParams: Promise<{ withdrawn?: string; scope?: string }>;
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
  const sp = await searchParams;
  const showWithdrawn = sp.withdrawn === "show";

  // D94 — pilot/main scope. Lists DEFAULT TO "all" (lookup view; cf. the
  // dashboard's active-phase default). versionMeta labels the per-row
  // variant chip from the same questionnaire_versions read.
  const { scope, versionIds, versionMeta } = await resolveOverviewScope(
    supabase,
    sp.scope ?? "all"
  );

  const responses = await listResponses(supabase, {
    hideWithdrawn: !showWithdrawn,
  });

  // Invitation context via the role-branching repo (NOT an embed). ref_code,
  // category, nationality, status are non-PII — present and identical on both
  // the base table and invitations_redacted.
  //
  // D94 — the invitation fetch is SCOPE-FILTERED (versionIds). This is also
  // how responses get scoped: responses has no questionnaire_version_id
  // column, and embedding invitations here would breach the PII boundary
  // (readonly would get ciphertext, bypassing invitations_redacted). So we
  // scope the invitation set, then drop response rows whose invitation
  // isn't in it (below) — reusing the existing in-memory join, zero extra
  // queries, PII boundary intact. null (All) → unscoped → no rows dropped.
  const invitations = await listInvitations(supabase, {
    questionnaireVersionIds: versionIds ?? undefined,
  });
  const invMap = new Map(invitations.map((i) => [i.id, i]));

  // D94 — apply the pilot/main scope. A response is in-scope iff its
  // invitation is in the scoped invMap. When unscoped (All), versionIds
  // is null → keep everything (invMap holds all invitations anyway).
  const scopedResponses =
    versionIds === null
      ? responses
      : responses.filter((r) => invMap.has(r.invitationId));

  // Non-empty answer counts, one query, joined in memory. Computed over
  // the SCOPED set only (no point counting rows we won't render).
  const counts = await getAnswerCounts(
    supabase,
    scopedResponses.map((r) => r.id)
  );

  const rows = scopedResponses.map((r) => {
    const inv = invMap.get(r.invitationId);
    return {
      id: r.id,
      refCode: inv?.refCode ?? "—",
      category: inv?.category ?? null,
      nationality: inv?.nationality ?? null,
      status: inv?.status ?? null,
      collectionMode: inv?.collectionMode ?? null,
      // D94 — version id for the variant chip (resolved via versionMeta
      // at render). Null when the invitation join is missing (defensive).
      questionnaireVersionId: inv?.questionnaireVersionId ?? null,
      language: r.language,
      startedAt: r.startedAt,
      submittedAt: r.submittedAt,
      // D82 — ACTIVE engagement duration (first-answer-save → submit), NOT
      // consent-to-submit calendar time. Start milestone sourced from
      // invitations.started_at (set guard-once by saveAnswer on first
      // upsert); end from response.submittedAt. The invMap.get is the
      // same one used for category/nationality above — zero extra queries.
      // Null when invitation.startedAt is null (legacy/pre-Session-2b) or
      // response isn't submitted — em-dash renders in either case.
      durationMinutes: computeActiveDurationMinutes(
        inv?.startedAt ?? null,
        r.submittedAt
      ),
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

  // D94 — withdrawn-toggle href that PRESERVES the active scope (so the
  // scope filter and the withdrawn toggle compose both directions). The
  // ScopeFilter component handles the reverse (preserving ?withdrawn).
  const withdrawnToggleHref = (() => {
    const params = new URLSearchParams();
    if (scope !== "all") params.set("scope", scope);
    if (!showWithdrawn) params.set("withdrawn", "show"); // toggling ON
    const qs = params.toString();
    return qs ? `/admin/responses?${qs}` : "/admin/responses";
  })();

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="eyebrow mb-1">Admin</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              Responses
            </h1>
            {/* D94 — count reflects the scoped + withdrawn-filtered set; a
                non-All scope is named so it never reads as a global total. */}
            <p className="text-[13px] text-muted mt-1">
              {rows.length} {showWithdrawn ? "total" : "active"}
              {scope !== "all" && <> · {SCOPE_LABEL[scope]}</>} · signed in as{" "}
              {admin.name} ({admin.role})
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* D94 — pilot/main scope filter. Composes (AND) with the
                withdrawn toggle: ScopeFilter preserves ?withdrawn, and the
                toggle below preserves ?scope. */}
            <ScopeFilter active={scope} />
            {/* Default-OFF withdrawn-hide toggle. Query-string driven so
                the chosen view survives a refresh / can be bookmarked.
                D94 — preserves the active scope across the toggle. */}
            <Link href={withdrawnToggleHref} className="btn-ghost text-[12px]">
              {showWithdrawn ? "Hide withdrawn" : "Show withdrawn"}
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            {/* D94 — scope-aware empty state. */}
            {scope === "all"
              ? "No responses yet. They appear once an invitee opens their link."
              : `No responses in the ${SCOPE_LABEL[scope]} scope.`}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-bgAlt text-muted">
                <tr className="text-start">
                  <th className="text-start font-semibold px-4 py-2.5">Ref</th>
                  {/* D94 — variant chip column. */}
                  <th className="text-start font-semibold px-4 py-2.5">Variant</th>
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
                    {/* D94 — variant chip; meta from the scope read. */}
                    <td className="px-4 py-2.5">
                      <VariantChip
                        variant={
                          row.questionnaireVersionId
                            ? versionMeta.get(row.questionnaireVersionId)
                                ?.variant ?? null
                            : null
                        }
                        type={
                          row.questionnaireVersionId
                            ? versionMeta.get(row.questionnaireVersionId)
                                ?.type ?? null
                            : null
                        }
                      />
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
