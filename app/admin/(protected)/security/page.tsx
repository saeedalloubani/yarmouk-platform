// app/admin/(protected)/security/page.tsx
//
// Security — the audit-log viewer. OWNER-ONLY: a readonly supervisor is
// redirected away (mirrors the settings owner gate). RLS audit_log_owner_select
// is the real backstop; this UI gate keeps a non-owner from reaching the page
// at all, and the repo would return zero rows anyway.
//
// Shows the operational columns only — country / city are omitted (NULL
// until D26 ③ is wired). Non-PII by construction: audit rows carry codes /
// ids / roles, never names or tokens.
//
// D76 — filter surface + summary chips + higher page size (250). Filters
// are URL-persistent (HTML form GET; no client JS), so a filtered view is
// bookmarkable and survives a back-button navigation. Rolling-window date
// presets (last 24h / 7d / 30d) are resolved server-side to absolute
// timestamps before they reach the repo, which keeps the repo clock-free.
// Custom range uses literal <input type="date"> values, inclusive of the
// `to` day (… T23:59:59.999Z).
//
// D77 — the Details cell now expands in-place. When metadata is a non-empty
// object, the cell is a native HTML <details> element: the <summary> shows
// the same compact one-liner (formatMetadata) and the disclosure body shows
// the pretty-printed JSON. No client JS, fully keyboard-accessible (Tab to
// the summary, Enter/Space to toggle). The native disclosure triangle
// doubles as the "more is hidden here" affordance, so we don't need a
// custom truncation indicator. Falls back to the original truncated span
// when metadata is null / a scalar / an empty object / an array — no point
// expanding a value that won't read better in pretty-printed form.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  listAuditEvents,
  getAuditSummary,
  listDistinctActions,
  type AuditFilters,
} from "@/lib/repos/audit";
import { listAdmins } from "@/lib/repos/admins";
import type { Database, Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Severity = Database["public"]["Enums"]["event_severity"];

const PAGE_LIMIT = 250;

type RangeKey = "today" | "7d" | "30d" | "custom";

type SearchParamsShape = {
  severity?: string;
  range?: string;
  from?: string;
  to?: string;
  action?: string;
  actor?: string;
  resource?: string;
};

function isSeverity(v: string | undefined): v is Severity {
  return v === "info" || v === "warn" || v === "alert";
}

function isRangeKey(v: string | undefined): v is RangeKey {
  return v === "today" || v === "7d" || v === "30d" || v === "custom";
}

function isValidDateInput(v: string | undefined): v is string {
  // YYYY-MM-DD shape as emitted by <input type="date">.
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Translate URL searchParams into the AuditFilters shape the repo expects,
 * plus the preserved-range key + custom inputs we need to re-select the
 * dropdown / inputs after the server round-trip.
 *
 * Rolling-window date presets are resolved here, server-side, to absolute
 * ISO timestamps via Date.now(). Custom range uses literal date inputs
 * (T00:00:00.000Z for `from`; T23:59:59.999Z for `to` to include the full
 * target day). When `range` is absent or invalid, no date filter is
 * applied (= "all time").
 */
function resolveFilters(sp: SearchParamsShape): {
  filters: AuditFilters;
  rangeKey: RangeKey | "";
  customFrom: string;
  customTo: string;
} {
  const severity = isSeverity(sp.severity) ? sp.severity : undefined;
  const rangeKey: RangeKey | "" = isRangeKey(sp.range) ? sp.range : "";
  const customFrom = isValidDateInput(sp.from) ? sp.from : "";
  const customTo = isValidDateInput(sp.to) ? sp.to : "";

  let from: string | undefined;
  let to: string | undefined;
  const HOUR_MS = 3_600_000;
  if (rangeKey === "today") {
    from = new Date(Date.now() - 24 * HOUR_MS).toISOString();
  } else if (rangeKey === "7d") {
    from = new Date(Date.now() - 7 * 24 * HOUR_MS).toISOString();
  } else if (rangeKey === "30d") {
    from = new Date(Date.now() - 30 * 24 * HOUR_MS).toISOString();
  } else if (rangeKey === "custom") {
    if (customFrom) from = `${customFrom}T00:00:00.000Z`;
    if (customTo) to = `${customTo}T23:59:59.999Z`;
  }

  const action = sp.action && sp.action.trim() !== "" ? sp.action : undefined;
  const actorId = sp.actor && sp.actor.trim() !== "" ? sp.actor : undefined;
  const resource =
    sp.resource && sp.resource.trim() !== "" ? sp.resource.trim() : undefined;

  return {
    filters: { severity, from, to, action, actorId, resource },
    rangeKey,
    customFrom,
    customTo,
  };
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// info → brand (neutral), warn → amber, alert → red. Existing tokens only.
function severityChipClasses(sev: Severity): string {
  switch (sev) {
    case "alert":
      return "bg-dangerLight text-danger";
    case "warn":
      return "bg-warnLight text-warn";
    default:
      return "bg-brand-50 text-brand-700";
  }
}

// Compact one-line "key: value · key: value" rendering of the metadata
// object. Empty / non-object metadata renders as an em-dash. Nested
// values are JSON-stringified so the line stays single-row; the full
// string is also set as the cell title for hover.
function formatMetadata(meta: Json): string {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return meta === null ? "—" : String(meta);
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .map(
      ([k, v]) =>
        `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`
    )
    .join(" · ");
}

// D77 — narrow the metadata to "non-empty plain object" so the table cell
// knows when the row deserves a <details> expander. Scalars / arrays /
// nulls / empty objects all keep the original truncated-span rendering.
function metadataIsExpandable(
  meta: Json
): meta is { [k: string]: Json } {
  return (
    meta !== null &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    Object.keys(meta).length > 0
  );
}

// D77 — pretty-printed JSON for the expanded body. 2-space indent;
// whitespace and long URN-like values wrap inside the <pre>. Kept as a
// plain JSON.stringify (no field renaming) so the expanded view is a
// faithful mirror of the underlying metadata.
function prettyMetadata(meta: { [k: string]: Json }): string {
  return JSON.stringify(meta, null, 2);
}

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // audit log is owner-only

  const sp = await searchParams;
  const { filters, rangeKey, customFrom, customTo } = resolveFilters(sp);

  // Parallel fetch — 4 outer round-trips; getAuditSummary itself nests 3
  // parallel count-only round-trips inside Promise.all. Total wall-clock
  // = max(rows query, summary fan-out, distinct-actions, listAdmins) at
  // the slowest single round-trip.
  const [{ rows, totalCount }, summary, distinctActions, admins] =
    await Promise.all([
      listAuditEvents(supabase, filters, { limit: PAGE_LIMIT }),
      getAuditSummary(supabase, filters),
      listDistinctActions(supabase),
      listAdmins(supabase),
    ]);

  const severityQuery = filters.severity ?? "";
  const actionQuery = filters.action ?? "";
  const actorQuery = filters.actorId ?? "";
  const resourceQuery = filters.resource ?? "";

  const hasAnyFilter =
    !!severityQuery ||
    !!rangeKey ||
    !!actionQuery ||
    !!actorQuery ||
    !!resourceQuery;

  return (
    <main className="min-h-screen bg-white">
      {/* D81 Item 3 — widened to max-w-6xl from max-w-5xl. Audit log is
          data-dense (7 columns) and the Details column was overflowing the
          old container; the wider container relieves cumulative column
          pressure. Localized to /admin/security; the rest of /admin/*
          stays text-dense at max-w-5xl. */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Security
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Audit log — admin actions, newest first
          </p>
        </div>

        {/* Summary chips — filtered totals (drill-in feedback). When a
            severity filter is active, the other-severity chips show 0
            (countAuditBySeverity short-circuits without a round-trip). */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="chip-solid bg-bgAlt text-ink">
            {summary.total} events
          </span>
          <span className="chip-solid bg-brand-50 text-brand-700">
            {summary.info} info
          </span>
          <span className="chip-solid bg-warnLight text-warn">
            {summary.warn} warn
          </span>
          <span className="chip-solid bg-dangerLight text-danger">
            {summary.alert} alert
          </span>
        </div>

        {/* Filter form — HTML method=GET, no client JS. Empty inputs
            still submit as `&name=` keys; the URL gets a little verbose
            after one filter pass but resolveFilters treats empty strings
            as undefined, so results stay correct. The "Clear" link
            navigates to the bare page, stripping all params. The custom
            from/to inputs stay enabled regardless of the range select
            (per D76 decision B); the server only reads them when
            range=custom. */}
        <form
          method="GET"
          action="/admin/security"
          className="card p-4 mb-5 grid grid-cols-1 md:grid-cols-3 gap-3 items-end text-[13px]"
        >
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Severity</span>
            <select
              name="severity"
              defaultValue={severityQuery}
              className="border border-line rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">All severities</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="alert">alert</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Date range</span>
            <select
              name="range"
              defaultValue={rangeKey}
              className="border border-line rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">All time</option>
              <option value="today">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Action</span>
            <select
              name="action"
              defaultValue={actionQuery}
              className="border border-line rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">All actions</option>
              {distinctActions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Custom from</span>
            <input
              type="date"
              name="from"
              defaultValue={customFrom}
              className="border border-line rounded-md px-2 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Custom to</span>
            <input
              type="date"
              name="to"
              defaultValue={customTo}
              className="border border-line rounded-md px-2 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">Actor</span>
            <select
              name="actor"
              defaultValue={actorQuery}
              className="border border-line rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">All actors</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status === "removed" ? " (removed)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-muted text-[12px]">
              Resource contains
            </span>
            <input
              type="text"
              name="resource"
              defaultValue={resourceQuery}
              placeholder="ref code or text…"
              className="border border-line rounded-md px-2 py-1.5"
            />
          </label>

          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary text-[12px]">
              Apply filters
            </button>
            {hasAnyFilter && (
              <Link href="/admin/security" className="btn-ghost text-[12px]">
                Clear
              </Link>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            {hasAnyFilter
              ? "No audit events match these filters."
              : "No audit events recorded yet."}
          </div>
        ) : (
          <>
            {/* D81 Item 3 — inner overflow-x-auto wrapper preserves the
                card's rounded corners while letting the table scroll
                horizontally when the cumulative column widths exceed the
                viewport (the Details column was being clipped off-screen
                before this). Density-tightened columns (Time / Severity /
                IP → px-3) recover ~50px for Details inside the visible
                width before scroll kicks in. */}
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-bgAlt text-muted">
                  <tr className="text-start">
                    <th className="text-start font-semibold px-3 py-2.5">
                      Time
                    </th>
                    <th className="text-start font-semibold px-3 py-2.5">
                      Severity
                    </th>
                    <th className="text-start font-semibold px-4 py-2.5">
                      Actor
                    </th>
                    <th className="text-start font-semibold px-3 py-2.5">IP</th>
                    <th className="text-start font-semibold px-4 py-2.5">
                      Action
                    </th>
                    <th className="text-start font-semibold px-4 py-2.5">
                      Resource
                    </th>
                    <th className="text-start font-semibold px-4 py-2.5">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const meta = formatMetadata(e.metadata);
                    return (
                      <tr key={e.id} className="border-t border-line align-top">
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                          {fmtTimestamp(e.ts)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`chip-solid ${severityChipClasses(
                              e.severity
                            )}`}
                          >
                            {e.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-ink">
                            {e.actorName ?? "—"}
                          </span>
                          {e.actorRole && (
                            <span className="block text-[11px] text-muted">
                              {e.actorRole}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {e.ip ? (
                            <span
                              className="mono text-[12px]"
                              title={e.userAgent ?? undefined}
                            >
                              {e.ip}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="mono text-brand-700">
                            {e.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {e.resource ? (
                            <span className="mono">{e.resource}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {metadataIsExpandable(e.metadata) ? (
                            // D77 — native <details> expander. The
                            // disclosure triangle is the affordance: the
                            // summary stays truncated single-line so the
                            // table preserves its compact rhythm, and the
                            // body pretty-prints the full metadata object
                            // when toggled open. No client JS; keyboard-
                            // accessible (Tab to summary, Enter/Space to
                            // toggle). Multiple rows can be open
                            // simultaneously.
                            <details className="max-w-[360px] group">
                              <summary
                                className="expandable-summary block truncate text-muted cursor-pointer hover:text-ink"
                                title={meta}
                              >
                                {meta}
                              </summary>
                              <pre className="mono mt-2 p-2 bg-bgAlt rounded text-[11px] text-ink whitespace-pre-wrap break-all border-s-2 border-line">
                                {prettyMetadata(e.metadata)}
                              </pre>
                            </details>
                          ) : (
                            <span
                              className="block max-w-[320px] truncate text-muted"
                              title={meta}
                            >
                              {meta}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            <p className="text-[12px] text-muted mt-3">
              {totalCount <= PAGE_LIMIT
                ? `Showing ${rows.length} of ${totalCount} events.`
                : `Showing ${rows.length} of ${totalCount} events. Refine filters to see more.`}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
