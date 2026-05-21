// app/admin/(protected)/page.tsx
//
// Admin Overview dashboard (Session 4 — admin dashboard). Real read-
// aggregation over existing data via lib/repos/dashboard.ts (identity-free:
// ref_codes + counts only; reads invitations_redacted, never the PII base
// table). Mirrors the mock's four real-data sections — KPIs, completion by
// category, recent activity, at-a-glance — and OMITS the mock's interpretive
// / later-session pieces (Pilot Feedback Signal, Export/Progress-Report/
// Publish-V2, analytics links). Every stat is null-safe: a fresh DB reads
// "0 / 0% / — / No activity yet" by design.
//
// Nav + sign-out live in the AdminShell (the layout); this page is content.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getDashboardData, type CategoryStat } from "@/lib/repos/dashboard";
import { categoryLabel } from "@/lib/repos/invitations";

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

export default async function AdminOverviewPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  const d = await getDashboardData(supabase);

  return (
    <div className="p-10 max-w-6xl">
      <div className="mb-8">
        <div className="eyebrow mb-2">Pilot · Version 1</div>
        <h1 className="text-[28px] font-bold text-ink tracking-tight mb-1">
          Overview
        </h1>
        <p className="text-[14px] text-muted">
          Real-time status of the pilot questionnaire round.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Kpi label="Invited" value={String(d.invited)} sub="across 4 categories" />
        <Kpi
          label="Submitted"
          value={String(d.submitted)}
          sub={`${d.completionPct}% completion`}
          accent
        />
        <Kpi
          label="In progress"
          value={String(d.inProgress)}
          sub="started, not submitted"
        />
        <Kpi
          label="Avg. duration"
          value={d.avgDurationMinutes != null ? `${d.avgDurationMinutes}m` : "—"}
          sub="end-to-end"
        />
      </div>

      {/* Completion by category + recent activity */}
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

      {/* At a glance */}
      <div className="card p-6">
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
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`${
        accent ? "bg-accent-600 border-accent-600" : "bg-white border-line"
      } border rounded-lg p-5`}
    >
      <div
        className={`text-[12px] font-semibold mb-2 ${
          accent ? "text-accent-100" : "text-muted"
        }`}
      >
        {label}
      </div>
      <div
        className={`text-[32px] font-bold leading-none tracking-tight mb-1 ${
          accent ? "text-white" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className={`text-[12px] ${accent ? "text-accent-100" : "text-muted-faint"}`}>
        {sub}
      </div>
    </div>
  );
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
