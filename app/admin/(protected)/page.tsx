// app/admin/(protected)/page.tsx
//
// Admin Overview — extended in D79 (Feature 1) with pilot-status surfaces
// while preserving the existing Session 4 real-data sections.
//
// Layout (top → bottom):
//   1. Header (eyebrow + H1) — preserved.
//   2. Flash banner (D79) — surfaces ?reminder=sent|failed&ref=…&reason=…
//      query params from the SendReminderButton POST redirect.
//   3. Stalled-invitations table (D79) — owner-only action surface with
//      one SendReminderButton per row. Two cuts shown distinguished by
//      chip: "Never opened" vs "Started, not submitted" (FLAG E /
//      decided Q5 of D79 read-first).
//   4. 4-stage funnel chips (D79) — replaces the old KPI cards. Sent →
//      Opened → Started → Submitted with cumulative percentages of Sent.
//   5. Completion by Category + Recent Activity — preserved verbatim.
//   6. At a glance — preserved verbatim.
//   7. Cron schedule footer (D79) — visibility into when the daily
//      reminder cron fires next.
//
// PII discipline: identity-free by construction. Same path as
// getDashboardData (invitations_redacted, ref_codes + counts only); the
// stalled-invitation repo also uses the redacted view. Decryption only
// happens server-side INSIDE the send-reminder POST handler, never on
// this page.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getDashboardData, type CategoryStat } from "@/lib/repos/dashboard";
import { categoryLabel } from "@/lib/repos/invitations";
import {
  getStalledInvitations,
  getPilotFunnel,
  type StalledInvitation,
} from "@/lib/repos/pilot";
import SendReminderButton from "@/components/SendReminderButton";

export const dynamic = "force-dynamic";

const CATEGORY_COLOR: Record<string, string> = {
  officials: "#194a75",
  researchers: "#2f78a1",
  ngos: "#5293b9",
  donors: "#5d9477",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Flash-banner shape resolved from the POST redirect's query params. */
type ReminderFlash =
  | { kind: "sent"; ref: string }
  | { kind: "failed"; ref: string; reason: string; waitMin: string | null }
  | null;

function parseFlash(sp: {
  reminder?: string;
  ref?: string;
  reason?: string;
  wait?: string;
}): ReminderFlash {
  if (sp.reminder === "sent" && sp.ref) {
    return { kind: "sent", ref: sp.ref };
  }
  if (sp.reminder === "failed" && sp.ref) {
    return {
      kind: "failed",
      ref: sp.ref,
      reason: sp.reason ?? "unknown",
      waitMin: sp.wait ?? null,
    };
  }
  return null;
}

/** Friendly text for each failure reason. Falls through to a generic
 *  "delivery error" copy for buckets we don't have a tailored message
 *  for. NEVER surfaces raw error.message (PII risk). */
function flashFailureMessage(
  ref: string,
  reason: string,
  waitMin: string | null
): string {
  switch (reason) {
    case "rate_limited":
      return waitMin
        ? `Reminder cooldown active for ${ref}. Please wait ${waitMin} minute(s) before retrying.`
        : `Reminder cooldown active for ${ref}.`;
    case "send":
      return `Email delivery failed for ${ref}. Check Resend dashboard / audit log.`;
    case "decrypt":
      return `Could not decrypt recipient data for ${ref}. See RUNBOOK Vault key DR.`;
    case "config":
      return `Server misconfigured (RESEND_API_KEY or NEXT_PUBLIC_SITE_URL). See RUNBOOK.`;
    case "not_found":
      return `Invitation not found (${ref}).`;
    case "ineligible":
      return `${ref} is in a terminal or expired state — cannot send reminder. Resend instead.`;
    case "invalid_id":
      return `Invalid invitation id.`;
    default:
      return `Could not send reminder to ${ref}.`;
  }
}

const STALL_CHIP_LABEL: Record<StalledInvitation["stallReason"], string> = {
  never_opened: "Never opened",
  started_not_submitted: "Started, not submitted",
};

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    reminder?: string;
    ref?: string;
    reason?: string;
    wait?: string;
  }>;
}) {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  // Parallel — three independent repos. Dashboard is the largest read
  // (multi-table aggregate); the two pilot reads add ~2 round-trips. All
  // fan out at once.
  const sp = await searchParams;
  const flash = parseFlash(sp);
  const isOwner = admin.role === "owner";

  const [d, stalled, funnel] = await Promise.all([
    getDashboardData(supabase),
    // Stalled-invitations table is owner-action surface. Readonly
    // supervisors don't get the table at all (the data is benign — no
    // PII — but the Send Reminder button only makes sense for the
    // actor who can pull the trigger). Skip the query for non-owner.
    isOwner ? getStalledInvitations(supabase) : Promise.resolve([]),
    getPilotFunnel(supabase),
  ]);

  return (
    <div className="p-10 max-w-6xl">
      <div className="mb-6">
        <div className="eyebrow mb-2">Pilot · Version 1</div>
        <h1 className="text-[28px] font-bold text-ink tracking-tight mb-1">
          Overview
        </h1>
        <p className="text-[14px] text-muted">
          Real-time status of the pilot questionnaire round.
        </p>
      </div>

      {/* D79 Feature 3 — flash banner from POST redirect. Dismisses on
          next navigation (it's just URL-param-driven render; no client JS). */}
      {flash?.kind === "sent" && (
        <div className="notice-success mb-6">
          <span>
            ✓ Reminder sent to <span className="mono">{flash.ref}</span>.
          </span>
        </div>
      )}
      {flash?.kind === "failed" && (
        <div className="notice-warn mb-6">
          <span>{flashFailureMessage(flash.ref, flash.reason, flash.waitMin)}</span>
        </div>
      )}

      {/* D79 Feature 1 — stalled invitations table (owner-action surface).
          Two cuts unioned, chip distinguishes. Empty state when nothing
          is stalled OR when the viewer is read-only (in which case the
          stalled array was Promise.resolve([])). The latter case is
          unsurfaced by design — read-only admins don't need a "the owner
          has work to do" panel. */}
      {isOwner && (
        <section className="card p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-[16px] font-bold text-ink mb-1">
                Needs a nudge
              </h2>
              <p className="text-[12px] text-muted">
                Stalled invitations — manual reminder available. Cron auto-
                fires reminder1 at sent + 7 days regardless.
              </p>
            </div>
            <Link href="/admin/invitations" className="btn-ghost text-[12px]">
              All invitations →
            </Link>
          </div>
          {stalled.length === 0 ? (
            <p className="text-[13px] text-muted">
              No stalled invitations. Everyone we&apos;ve invited has either
              submitted, is in a terminal state, or hasn&apos;t crossed a
              stall threshold yet.
            </p>
          ) : (
            <div className="overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-bgAlt text-muted">
                  <tr className="text-start">
                    <th className="text-start font-semibold px-3 py-2">Ref</th>
                    <th className="text-start font-semibold px-3 py-2">
                      Category
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Nationality
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Stall
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Days since sent
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Next cron fire
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Expires
                    </th>
                    <th className="text-start font-semibold px-3 py-2">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stalled.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className="mono font-semibold text-brand-700">
                          {s.refCode}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {categoryLabel(s.category)}
                      </td>
                      <td className="px-3 py-2 capitalize">
                        {s.nationality ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            s.stallReason === "started_not_submitted"
                              ? "chip-solid bg-warnLight text-warn"
                              : "chip-solid bg-brand-50 text-brand-700"
                          }
                        >
                          {STALL_CHIP_LABEL[s.stallReason]}
                        </span>
                      </td>
                      <td className="px-3 py-2 mono">{s.daysSinceSent}d</td>
                      <td className="px-3 py-2 text-muted">
                        {s.nextCronFireAt
                          ? fmtDate(s.nextCronFireAt)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {fmtDate(s.expiresAt)}{" "}
                        <span className="text-muted-faint">
                          ({s.daysUntilExpiry}d)
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <SendReminderButton
                          invitationId={s.id}
                          refCode={s.refCode}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* D79 Feature 1 — 4-stage funnel chips (replaces old KPI cards).
          Cumulative: Opened/Sent, Started/Sent, Submitted/Sent (relative
          to Sent denominator). */}
      <div className="card p-6 mb-8">
        <h2 className="text-[16px] font-bold text-ink mb-4">Funnel</h2>
        <div className="flex flex-wrap items-center gap-2">
          <FunnelChip
            label="Sent"
            value={funnel.sent}
            pct={null}
            color="bg-brand-50 text-brand-700"
          />
          <FunnelArrow />
          <FunnelChip
            label="Opened"
            value={funnel.opened}
            pct={funnel.pctOpened}
            color="bg-brand-100 text-brand-700"
          />
          <FunnelArrow />
          <FunnelChip
            label="Started"
            value={funnel.started}
            pct={funnel.pctStarted}
            color="bg-accent-100 text-accent-800"
          />
          <FunnelArrow />
          <FunnelChip
            label="Submitted"
            value={funnel.submitted}
            pct={funnel.pctSubmitted}
            color="bg-accent-600 text-white"
          />
        </div>
        {d.avgDurationMinutes != null && (
          <p className="text-[12px] text-muted mt-3">
            Average engagement time:{" "}
            <span className="font-semibold text-ink">
              {d.avgDurationMinutes} min
            </span>
            {" · "}
            {funnel.submitted} submitted response{funnel.submitted === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      {/* PRESERVED — Completion by Category + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-[16px] font-bold text-ink mb-1">
                Completion by Category
              </h2>
              <p className="text-[12px] text-muted">Pilot · V1</p>
            </div>
            <Link href="/admin/responses" className="btn-ghost text-[12px]">
              View responses →
            </Link>
          </div>

          <div className="space-y-5">
            {d.byCategory.map((c) => (
              <CategoryBar key={c.category} stat={c} />
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-[16px] font-bold text-ink mb-5">Recent Activity</h2>
          {d.recentActivity.length === 0 ? (
            <p className="text-[13px] text-muted">No activity yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {d.recentActivity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-600 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-ink leading-snug">
                      {a.label}: <span className="mono text-brand-700">{a.refCode}</span>
                    </div>
                    <div className="text-[11px] text-muted-faint mt-0.5">
                      {relativeTime(a.at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* PRESERVED — At a glance */}
      <div className="card p-6 mb-8">
        <h2 className="text-[16px] font-bold text-ink mb-5">At a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <Mini
            label="Languages used"
            value={
              d.languages.length > 0
                ? d.languages.map((l) => l.toUpperCase()).join(" · ")
                : "—"
            }
          />
          <Mini
            label="Median word count"
            value={d.medianWords != null ? String(d.medianWords) : "—"}
          />
          <Mini label="Most-applied tag" value={d.mostAppliedTag ?? "—"} />
          <Mini
            label="Avg. response length"
            value={d.avgWords != null ? `${d.avgWords}w` : "—"}
          />
        </div>
      </div>

      {/* D79 Feature 1 — operational footer. Cron-schedule visibility +
          deep links to the operational surfaces Sura uses next. */}
      <div className="card p-5 text-[12px] text-muted">
        <p className="mb-2">
          <strong className="text-ink">Reminder cron</strong> runs daily at
          12:00 UTC (Vercel scheduler). reminder1 fires at sent + 7 days;
          reminderFinal at sent + 14 days. Manual reminders don&apos;t
          change cron&apos;s schedule.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/admin/invitations" className="text-brand-700 hover:underline">
            Invitations
          </Link>
          <Link href="/admin/responses" className="text-brand-700 hover:underline">
            Responses
          </Link>
          <Link href="/admin/exports" className="text-brand-700 hover:underline">
            Export center
          </Link>
          {isOwner && (
            <Link href="/admin/security" className="text-brand-700 hover:underline">
              Security (audit log)
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelChip({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: number;
  pct: number | null;
  color: string;
}) {
  return (
    <span
      className={`chip-solid ${color} inline-flex items-baseline gap-1.5 text-[12px]`}
    >
      <span className="font-semibold">{label}</span>
      <span className="mono text-[13px] font-semibold">{value}</span>
      {pct != null && (
        <span className="text-[11px] opacity-80">({pct}%)</span>
      )}
    </span>
  );
}

function FunnelArrow() {
  return <span className="text-muted-faint text-[14px]">→</span>;
}

function CategoryBar({ stat }: { stat: CategoryStat }) {
  const pct = stat.invited > 0 ? (stat.submitted / stat.invited) * 100 : 0;
  const color = CATEGORY_COLOR[stat.category] ?? "#1e5b8f";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: color }}
          />
          <span className="text-[14px] font-semibold text-ink">
            {categoryLabel(stat.category)}
          </span>
        </div>
        <div className="text-[12px] text-muted">
          <span className="font-semibold text-ink">{stat.submitted}</span> /{" "}
          {stat.invited}
          <span className="text-muted-faint ms-1">({Math.round(pct)}%)</span>
        </div>
      </div>
      <div className="h-2 bg-bgAlt rounded-full overflow-hidden">
        <div
          className="h-full transition-all duration-700 rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted mb-1">{label}</div>
      <div className="text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}
