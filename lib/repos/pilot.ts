// lib/repos/pilot.ts
//
// D79 — pilot-status read aggregation that complements lib/repos/dashboard.ts.
// Two surfaces this repo powers:
//   1. Stalled-invitations table on /admin (Feature 1 dashboard extension).
//   2. Rate-limit lookup for the manual-reminder route (Feature 3).
//
// Non-PII by construction. Pulls from invitations_redacted (the redacted
// VIEW, not the base table) so name/email columns are NULL and there's no
// PII path even in principle. Pulls from responses (non-PII allow-list)
// for the started-not-submitted cut.
//
// Owner-gate is the page's job; this repo runs against the authenticated
// server client so RLS applies. Readonly admins get the same non-PII
// view (categories + ref_codes + lifecycle timestamps — they already see
// these via the existing dashboard repo).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

/**
 * Stall classification — the chip the dashboard renders next to the
 * refCode. Determines the framing ("Never opened" vs "Started, not
 * submitted") but NOT the action: Send Reminder is the same call for
 * both cuts, with the same reminder1 template. The cuts are the
 * dashboard's diagnostic signal, not a behavior switch.
 */
export type StallReason = "never_opened" | "started_not_submitted";

export type StalledInvitation = {
  id: string;
  refCode: string;
  category: string;
  nationality: string | null;
  /** Day Sura sent it (cron's 7d / 14d anchor). */
  sentAt: string;
  /** Days since sentAt (rounded down). Drives "needs nudge?" intuition. */
  daysSinceSent: number;
  /** "+7 day" or "+14 day" anchor — when cron will next fire for this row,
   *  ISO format. Null if the row is already past both reminder windows
   *  (reminderFinal_sent_at not null implies no further auto-fire). */
  nextCronFireAt: string | null;
  /** UI chip label class. */
  stallReason: StallReason;
  /** ISO; days until expiry. */
  expiresAt: string;
  daysUntilExpiry: number;
  /** Cron stamps — informational for the dashboard ("cron already nudged"). */
  reminder1SentAt: string | null;
  reminderFinalSentAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_1_DAYS = 7;
const REMINDER_FINAL_DAYS = 14;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS
  );
}

/**
 * The two stalled-invitation cuts unioned + sorted (oldest stall first,
 * since older stalls need attention sooner).
 *
 * Cut A — "never_opened": invitation sent, recipient hasn't opened the
 *         email. No response row exists. UI nudge: standard reminder.
 * Cut B — "started_not_submitted": recipient opened + began answering,
 *         but a `responses` row exists with started_at NOT NULL and
 *         submitted_at NULL. UI nudge: standard reminder (same template).
 *
 * Excludes:
 *   - submitted (terminal success)
 *   - revoked   (owner killed)
 *   - any row past expires_at (cron won't fire either, expired link)
 *
 * The query plan: pull all non-terminal active rows from the redacted
 * view, then split client-side by whether a started response exists.
 * Cheaper than two round-trips because the row count is small (a pilot
 * fits in tens, main study in low hundreds).
 */
export async function getStalledInvitations(
  supabase: SupabaseClient<Database>
): Promise<StalledInvitation[]> {
  const nowIso = new Date().toISOString();

  // ── 1. candidate invitations (non-terminal, not expired) ──────────
  const { data: invRows, error: invErr } = await supabase
    .from("invitations_redacted")
    .select(
      "id, ref_code, category, nationality, status, sent_at, expires_at, reminder1_sent_at, reminder_final_sent_at"
    )
    .in("status", ["sent", "opened", "started"])
    .gt("expires_at", nowIso);
  if (invErr) throw invErr;
  const candidates = invRows ?? [];
  if (candidates.length === 0) return [];

  // ── 2. which of those have a started, non-submitted response? ─────
  // Pull responses for the candidate set in a single query; project the
  // invitation_id only. We classify per-id below.
  const invIds = candidates
    .map((c) => c.id)
    .filter((id): id is string => id != null);
  if (invIds.length === 0) return [];

  const { data: respRows, error: respErr } = await supabase
    .from("responses")
    .select("invitation_id, started_at, submitted_at")
    .in("invitation_id", invIds);
  if (respErr) throw respErr;

  const startedNotSubmittedIds = new Set<string>();
  for (const r of respRows ?? []) {
    if (r.started_at != null && r.submitted_at == null) {
      startedNotSubmittedIds.add(r.invitation_id);
    }
    // Submitted responses are filtered out via invitation.status above
    // (the invitation flips to "submitted" on submit), so we don't need
    // to additionally cross-check submitted_at here.
  }

  // ── 3. assemble StalledInvitation rows ────────────────────────────
  const out: StalledInvitation[] = [];
  for (const c of candidates) {
    if (!c.id || !c.ref_code || !c.category || !c.sent_at || !c.expires_at) {
      // View metadata reports nullable; runtime non-null for active
      // pilot rows. Skip anything missing the load-bearing fields rather
      // than risk a downstream undefined.
      continue;
    }
    const stallReason: StallReason = startedNotSubmittedIds.has(c.id)
      ? "started_not_submitted"
      : "never_opened";

    // Next cron fire: if reminder1 hasn't fired, that's the next window;
    // else reminderFinal; else null (cron is done with this row).
    let nextCronFireAt: string | null;
    if (!c.reminder1_sent_at) {
      nextCronFireAt = new Date(
        new Date(c.sent_at).getTime() + REMINDER_1_DAYS * DAY_MS
      ).toISOString();
    } else if (!c.reminder_final_sent_at) {
      nextCronFireAt = new Date(
        new Date(c.sent_at).getTime() + REMINDER_FINAL_DAYS * DAY_MS
      ).toISOString();
    } else {
      nextCronFireAt = null;
    }

    out.push({
      id: c.id,
      refCode: c.ref_code,
      category: c.category,
      nationality: c.nationality ?? null,
      sentAt: c.sent_at,
      daysSinceSent: daysBetween(c.sent_at, nowIso),
      nextCronFireAt,
      stallReason,
      expiresAt: c.expires_at,
      daysUntilExpiry: daysBetween(nowIso, c.expires_at),
      reminder1SentAt: c.reminder1_sent_at,
      reminderFinalSentAt: c.reminder_final_sent_at,
    });
  }

  // Sort: oldest sentAt first (most-stalled needs attention first).
  out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return out;
}

/**
 * 4-stage funnel for the dashboard's pilot-status chips:
 *   Sent → Opened → Started → Submitted
 *
 * Each stage is CUMULATIVE — Opened is "ever opened, regardless of
 * whether the recipient progressed further." Computed from invitation
 * lifecycle timestamps (invitation.sent_at / opened_at / submitted_at)
 * for three of the four stages, with one deliberate asymmetry for
 * Started (see D80 note below). We use the timestamp form because it's
 * stable across the status transitions a row goes through (a submitted
 * row WAS once opened; opened_at remains populated).
 *
 * Revoked and expired rows are excluded from the funnel (they're
 * terminal off-paths, not in-flight failures). The denominator is the
 * count of rows with sent_at populated (i.e. "actually sent").
 *
 * Percentages are computed relative to the Sent total (the funnel
 * mouth), which is the most intuitive read: "X% of the people we
 * emailed opened the link; Y% of them started; Z% submitted."
 *
 * D80 — STARTED count semantic. Two definitions of "started" coexist:
 *   - invitations.started_at  populated on first answer save
 *                             (Session 2b — opened→started transition).
 *   - responses.started_at    populated when the responder reaches
 *                             /consent and the response row is created.
 * The stalled-invitations surface (getStalledInvitations above) reads
 * responses.started_at; pre-D80 the funnel only read invitations.started_at,
 * which produced a UX-inconsistent count (funnel said Started=1 while the
 * stalled table showed 4 rows with "Started, not submitted"). We now
 * UNION both sources — an invitation counts as Started if EITHER its
 * invitations.started_at is populated OR a responses row exists with
 * started_at populated. The Set-based collector dedupes naturally
 * (multiple responses per invitation never inflate the count). Sent /
 * Opened / Submitted are NOT updated — there is no responses-side
 * divergent semantic for those stages; they stay invitations-only.
 */
export type PilotFunnel = {
  sent: number;
  opened: number;
  started: number;
  submitted: number;
  /** Whole-number percentages of the sent total. 0 when sent is 0. */
  pctOpened: number;
  pctStarted: number;
  pctSubmitted: number;
};

export async function getPilotFunnel(
  supabase: SupabaseClient<Database>
): Promise<PilotFunnel> {
  // D80 — `id` added to the SELECT so the responses-side union below
  // can match by invitation_id.
  const { data, error } = await supabase
    .from("invitations_redacted")
    .select("id, status, sent_at, opened_at, started_at, submitted_at");
  if (error) throw error;
  const rows = data ?? [];

  let sent = 0;
  let opened = 0;
  let submitted = 0;
  // D80 — invitations-side started signal feeds the Set; the responses-
  // side query below adds to the same Set so dedupe is automatic.
  const startedIds = new Set<string>();
  for (const r of rows) {
    if (r.status === "revoked" || r.status === "expired") continue;
    if (r.sent_at) sent += 1;
    if (r.opened_at) opened += 1;
    if (r.submitted_at) submitted += 1;
    if (r.started_at && r.id) startedIds.add(r.id);
  }

  // D80 — supplement with responses.started_at signal. Same defensive
  // null filter as getStalledInvitations (view metadata reports id as
  // nullable; runtime non-null for active pilot rows). We scope the
  // responses query to the non-terminal candidate set so we don't pull
  // every response row in the DB — at pilot scale (~7 rows) this is
  // tiny, but at main-study scale (low hundreds) the narrowing matters.
  // Server-side `.not("started_at", "is", null)` keeps the payload to
  // just the IDs we'll merge.
  const candidateIds = rows
    .filter((r) => r.status !== "revoked" && r.status !== "expired")
    .map((r) => r.id)
    .filter((id): id is string => id != null);
  if (candidateIds.length > 0) {
    const { data: respRows, error: respErr } = await supabase
      .from("responses")
      .select("invitation_id")
      .in("invitation_id", candidateIds)
      .not("started_at", "is", null);
    if (respErr) throw respErr;
    for (const r of respRows ?? []) {
      startedIds.add(r.invitation_id);
    }
  }

  const started = startedIds.size;
  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  return {
    sent,
    opened,
    started,
    submitted,
    pctOpened: pct(opened),
    pctStarted: pct(started),
    pctSubmitted: pct(submitted),
  };
}

/**
 * Most recent successful manual-reminder timestamp for a given refCode.
 * Returns null if there has never been one.
 *
 * Source of truth is audit_log on action='invitation.reminder_manual'
 * (FLAG D — no last_manual_reminder_at column; audit log is canonical).
 * The query reads via the authenticated client; only owners have RLS
 * access to audit_log (audit_log_owner_select), so this is implicitly
 * owner-gated alongside the route's explicit owner check.
 *
 * The 10-minute cooldown threshold lives in the route, not here — the
 * route compares Date.now() - this against the configurable constant.
 */
export async function getLastManualReminderAt(
  supabase: SupabaseClient<Database>,
  refCode: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("ts")
    .eq("action", "invitation.reminder_manual")
    .eq("resource", refCode)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.ts ?? null;
}
