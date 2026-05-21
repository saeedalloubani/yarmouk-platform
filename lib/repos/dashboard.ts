// lib/repos/dashboard.ts
//
// Read-aggregation for the admin Overview dashboard (Session 4 — admin
// dashboard). NON-PII and identity-free by construction:
//
//   - Invitation-derived stats (funnel, by-category, recent activity) read
//     `invitations_redacted` — the redacted VIEW, not the base table. The
//     view NULLs recipient_*_encrypted and omits token_hash, so PII can't
//     be reached even in principle; we additionally select only non-PII
//     columns. This sidesteps the 3c-i embed trap entirely (no PostgREST
//     embed onto the invitations base table, ever).
//   - Response/answer/tag stats read `responses`, `answers`,
//     `response_tags`→`tags` — all on the non-PII allow-list, both roles
//     SELECT. The response_tags→tags embed is safe (both non-PII; the trap
//     is specifically about PII *base* tables).
//
// NOTHING here selects recipient_name_encrypted / recipient_email_encrypted,
// and NOTHING decrypts. The dashboard shows ref_codes and counts only.
//
// EVERY aggregate is null-safe at 0 rows — the empty DB reads as
// "0 / 0% / — / no activity", which is intentional, not broken.
//
// Takes the authenticated server client so RLS applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type CategoryStat = {
  category: string;
  invited: number;
  submitted: number;
};

export type ActivityEvent = {
  refCode: string;
  label: string;
  at: string; // ISO timestamp
};

export type DashboardData = {
  // Funnel (status-based; invitation.status is maintained at each transition)
  invited: number;
  submitted: number;
  inProgress: number;
  completionPct: number; // 0 when invited === 0
  byCategory: CategoryStat[];
  recentActivity: ActivityEvent[];
  // At a glance (null = render "—")
  avgDurationMinutes: number | null;
  languages: ("en" | "ar")[];
  medianWords: number | null;
  avgWords: number | null;
  mostAppliedTag: string | null;
};

// The four categories always render, even at 0 invited (so the card isn't
// empty on a fresh DB). Order is display order.
const CATEGORIES: readonly string[] = [
  "officials",
  "researchers",
  "donors",
  "ngos",
];

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * One aggregate read for the whole dashboard. Each piece is independently
 * null-safe; a totally empty DB returns all zeros / nulls / empty arrays.
 */
export async function getDashboardData(
  supabase: SupabaseClient<Database>
): Promise<DashboardData> {
  // ---- Invitations (redacted view; non-PII columns only) --------------
  const { data: invRows, error: invErr } = await supabase
    .from("invitations_redacted")
    .select(
      "ref_code, category, status, sent_at, opened_at, started_at, submitted_at"
    );
  if (invErr) throw invErr;
  const invitations = invRows ?? [];

  const invited = invitations.length;
  const submitted = invitations.filter((i) => i.status === "submitted").length;
  const inProgress = invitations.filter(
    (i) => i.status === "opened" || i.status === "started"
  ).length;
  const completionPct = invited > 0 ? Math.round((submitted / invited) * 100) : 0;

  const byCategory: CategoryStat[] = CATEGORIES.map((category) => {
    const inCat = invitations.filter((i) => i.category === category);
    return {
      category,
      invited: inCat.length,
      submitted: inCat.filter((i) => i.status === "submitted").length,
    };
  });

  // Recent activity: expand each non-null lifecycle timestamp into an event,
  // newest first. ref_code only — never a name.
  const events: ActivityEvent[] = [];
  for (const i of invitations) {
    const code = i.ref_code ?? "—";
    if (i.sent_at) events.push({ refCode: code, label: "Invitation sent", at: i.sent_at });
    if (i.opened_at) events.push({ refCode: code, label: "Invitation opened", at: i.opened_at });
    if (i.started_at) events.push({ refCode: code, label: "Response started", at: i.started_at });
    if (i.submitted_at) events.push({ refCode: code, label: "Response submitted", at: i.submitted_at });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  const recentActivity = events.slice(0, 6);

  // ---- Responses (non-PII): avg duration + languages ------------------
  const { data: respRows, error: respErr } = await supabase
    .from("responses")
    .select("started_at, submitted_at, language");
  if (respErr) throw respErr;
  const responses = respRows ?? [];

  const durations: number[] = [];
  for (const r of responses) {
    if (r.submitted_at && r.started_at) {
      const ms = new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime();
      if (ms >= 0) durations.push(ms / 60000); // → minutes
    }
  }
  const avgDurationMinutes =
    durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : null;

  const languages = Array.from(
    new Set(responses.map((r) => r.language))
  ).filter((l): l is "en" | "ar" => l === "en" || l === "ar");

  // ---- Answers (non-PII): per-response word totals → median + mean ----
  const { data: ansRows, error: ansErr } = await supabase
    .from("answers")
    .select("response_id, word_count");
  if (ansErr) throw ansErr;

  const wordsByResponse = new Map<string, number>();
  for (const a of ansRows ?? []) {
    wordsByResponse.set(
      a.response_id,
      (wordsByResponse.get(a.response_id) ?? 0) + (a.word_count ?? 0)
    );
  }
  const responseTotals = [...wordsByResponse.values()];
  const medianWords = median(responseTotals);
  const avgWords =
    responseTotals.length > 0
      ? Math.round(responseTotals.reduce((s, w) => s + w, 0) / responseTotals.length)
      : null;

  // ---- Most-applied tag (response_tags → tags; both non-PII) ----------
  const { data: tagRows, error: tagErr } = await supabase
    .from("response_tags")
    .select("tag_id, tags(name)");
  if (tagErr) throw tagErr;

  const tagCounts = new Map<string, { name: string; count: number }>();
  for (const row of tagRows ?? []) {
    const name = row.tags?.name;
    if (!name) continue;
    const cur = tagCounts.get(row.tag_id);
    if (cur) cur.count += 1;
    else tagCounts.set(row.tag_id, { name, count: 1 });
  }
  let mostAppliedTag: string | null = null;
  let topCount = 0;
  for (const { name, count } of tagCounts.values()) {
    if (count > topCount) {
      topCount = count;
      mostAppliedTag = name;
    }
  }

  return {
    invited,
    submitted,
    inProgress,
    completionPct,
    byCategory,
    recentActivity,
    avgDurationMinutes,
    languages,
    medianWords,
    avgWords,
    mostAppliedTag,
  };
}
