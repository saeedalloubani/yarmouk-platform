// app/admin/(protected)/security/page.tsx
//
// Security — the audit-log viewer. OWNER-ONLY: a readonly supervisor is
// redirected away (mirrors the settings owner gate). RLS audit_log_owner_select
// is the real backstop; this UI gate keeps a non-owner from reaching the page
// at all, and the repo would return zero rows anyway.
//
// Shows the operational columns only — ip/country/city/user_agent are omitted
// (NULL until D26 request-context capture is wired). Non-PII by construction:
// audit rows carry codes/ids/roles, never names or tokens.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listAuditEvents, type AuditEventView } from "@/lib/repos/audit";
import type { Database, Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Severity = Database["public"]["Enums"]["event_severity"];

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

// Compact one-line "key: value · key: value" rendering of the metadata object.
// Empty / non-object metadata renders as an em-dash. Nested values are
// JSON-stringified so the line stays single-row; the full string is also set as
// the cell title for hover.
function formatMetadata(meta: Json): string {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return meta === null ? "—" : String(meta);
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function SecurityPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // audit log is owner-only

  const events: AuditEventView[] = await listAuditEvents(supabase, {
    limit: 100,
  });

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Security
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Audit log — admin actions, newest first
            {events.length > 0 && <> · showing {events.length}</>}
            {events.length === 100 && <> (most recent)</>}
          </p>
        </div>

        {events.length === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            No audit events recorded yet.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-bgAlt text-muted">
                <tr className="text-start">
                  <th className="text-start font-semibold px-4 py-2.5">Time</th>
                  <th className="text-start font-semibold px-4 py-2.5">
                    Severity
                  </th>
                  <th className="text-start font-semibold px-4 py-2.5">Actor</th>
                  <th className="text-start font-semibold px-4 py-2.5">IP</th>
                  <th className="text-start font-semibold px-4 py-2.5">Action</th>
                  <th className="text-start font-semibold px-4 py-2.5">
                    Resource
                  </th>
                  <th className="text-start font-semibold px-4 py-2.5">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const meta = formatMetadata(e.metadata);
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                        {fmtTimestamp(e.ts)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`chip-solid ${severityChipClasses(
                            e.severity
                          )}`}
                        >
                          {e.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-ink">{e.actorName ?? "—"}</span>
                        {e.actorRole && (
                          <span className="block text-[11px] text-muted">
                            {e.actorRole}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
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
                        <span className="mono text-brand-700">{e.action}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {e.resource ? (
                          <span className="mono">{e.resource}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="block max-w-[320px] truncate text-muted"
                          title={meta}
                        >
                          {meta}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
