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
  /** D81 Item 1 — per-row progress. Non-null only for `started_not_submitted`
   *  rows: `{ answered, total }` where `answered` = non-blank answers and
   *  `total` = visible non-feedback questions for the invitation's variant +
   *  nationality. `never_opened` rows have no response so progress = null
   *  (the dashboard renders an em-dash for these). */
  progress: { answered: number; total: number } | null;
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
  supabase: SupabaseClient<Database>,
  opts?: { versionIds?: string[] | null }
): Promise<StalledInvitation[]> {
  const nowIso = new Date().toISOString();
  const versionIds = opts?.versionIds ?? null;

  // ── 1. candidate invitations (non-terminal, not expired) ──────────
  // D81 — also pull questionnaire_version_id so the progress denominator
  // computation below has the variant key without an additional round-trip.
  // D93 — scope filter (pilot/main) applied here on the first query; the
  // responses + answers + questions reads below all derive from this
  // candidate set, so scoping it cascades to the whole function. Null =
  // no filter (All scope; pre-D93 behavior). Non-PII column already in
  // the redacted view.
  let invQuery = supabase
    .from("invitations_redacted")
    .select(
      "id, ref_code, category, nationality, status, sent_at, expires_at, reminder1_sent_at, reminder_final_sent_at, questionnaire_version_id"
    )
    .in("status", ["sent", "opened", "started"])
    .gt("expires_at", nowIso);
  if (versionIds !== null) {
    invQuery = invQuery.in("questionnaire_version_id", versionIds);
  }
  const { data: invRows, error: invErr } = await invQuery;
  if (invErr) throw invErr;
  const candidates = invRows ?? [];
  if (candidates.length === 0) return [];

  // ── 2. which of those have a started, non-submitted response? ─────
  // Pull responses for the candidate set in a single query; project the
  // invitation_id + id (D81 — needed to look up answers per response).
  // We classify per-id below.
  const invIds = candidates
    .map((c) => c.id)
    .filter((id): id is string => id != null);
  if (invIds.length === 0) return [];

  const { data: respRows, error: respErr } = await supabase
    .from("responses")
    .select("id, invitation_id, started_at, submitted_at")
    .in("invitation_id", invIds);
  if (respErr) throw respErr;

  const startedNotSubmittedIds = new Set<string>();
  // D81 — invitation_id → response_id for the started-not-submitted set,
  // so we can look up that response's non-blank answer count below.
  const responseIdByInvId = new Map<string, string>();
  for (const r of respRows ?? []) {
    if (r.started_at != null && r.submitted_at == null) {
      startedNotSubmittedIds.add(r.invitation_id);
      responseIdByInvId.set(r.invitation_id, r.id);
    }
    // Submitted responses are filtered out via invitation.status above
    // (the invitation flips to "submitted" on submit), so we don't need
    // to additionally cross-check submitted_at here.
  }

  // ── 2b. D81 Item 1 — per-row progress for started_not_submitted rows.
  //       For each such row we want:
  //         numerator   = non-blank answers (matches getAnswerCounts
  //                       semantic: trim → length > 0)
  //         denominator = visible non-feedback questions for the
  //                       invitation's variant + nationality
  //       Two batched queries (answers + questions) keep this O(1)
  //       round-trips regardless of stalled-row count.
  const answeredCountByResp = new Map<string, number>();
  const denomByKey = new Map<string, number>();
  if (startedNotSubmittedIds.size > 0) {
    const stalledRespIds = Array.from(responseIdByInvId.values());
    const { data: ansRows, error: ansErr } = await supabase
      .from("answers")
      .select("response_id, answer_text")
      .in("response_id", stalledRespIds);
    if (ansErr) throw ansErr;
    for (const a of ansRows ?? []) {
      if ((a.answer_text ?? "").trim().length > 0) {
        answeredCountByResp.set(
          a.response_id,
          (answeredCountByResp.get(a.response_id) ?? 0) + 1
        );
      }
    }

    // Unique version_ids across the stalled set — usually 1 in the pilot
    // (single variant) but could be many in main study.
    const stalledVersionIds = Array.from(
      new Set(
        candidates
          .filter((c) => c.id && startedNotSubmittedIds.has(c.id))
          .map((c) => c.questionnaire_version_id)
          .filter((v): v is string => v != null)
      )
    );
    if (stalledVersionIds.length > 0) {
      const { data: qRows, error: qErr } = await supabase
        .from("questions")
        .select("version_id, is_feedback, visible_nationalities")
        .in("version_id", stalledVersionIds)
        .eq("is_feedback", false);
      if (qErr) throw qErr;
      // Group by (version_id, nationality-bucket). Key = "version_id|nat"
      // where nat is the literal nationality string or "*" for universal
      // questions. We compute the denominator on demand per row by
      // summing the universal bucket + the row's nationality bucket.
      const universalByVersion = new Map<string, number>();
      const byKey = new Map<string, number>();
      for (const q of qRows ?? []) {
        const v = q.version_id;
        if (q.visible_nationalities === null) {
          universalByVersion.set(v, (universalByVersion.get(v) ?? 0) + 1);
        } else {
          for (const nat of q.visible_nationalities) {
            const key = `${v}|${nat}`;
            byKey.set(key, (byKey.get(key) ?? 0) + 1);
          }
        }
      }
      // Cache per-(version_id, nationality) denominators that the row
      // loop below will look up. Pre-merge: total = universal + nat-specific.
      for (const c of candidates) {
        if (!c.id || !startedNotSubmittedIds.has(c.id)) continue;
        const v = c.questionnaire_version_id;
        const nat = c.nationality;
        if (!v) continue;
        const key = `${v}|${nat ?? "*"}`;
        if (denomByKey.has(key)) continue;
        const universal = universalByVersion.get(v) ?? 0;
        const natSpecific = nat ? byKey.get(`${v}|${nat}`) ?? 0 : 0;
        denomByKey.set(key, universal + natSpecific);
      }
    }
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

    // D81 Item 1 — per-row progress for the started_not_submitted cut.
    // never_opened rows stay progress=null (no response exists).
    let progress: { answered: number; total: number } | null = null;
    if (stallReason === "started_not_submitted") {
      const respId = responseIdByInvId.get(c.id);
      const answered = respId
        ? answeredCountByResp.get(respId) ?? 0
        : 0;
      const total = c.questionnaire_version_id
        ? denomByKey.get(`${c.questionnaire_version_id}|${c.nationality ?? "*"}`) ?? 0
        : 0;
      // Only surface progress when the denominator is sane (>0). A zero
      // denominator would degrade the dashboard's bar UI; we'd rather
      // fall back to em-dash than render `[░░░] 0/0`.
      progress = total > 0 ? { answered, total } : null;
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
      progress,
    });
  }

  // Sort: oldest sentAt first (most-stalled needs attention first).
  out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return out;
}

/**
 * 5-stage funnel for the dashboard's pilot-status chips (D81 Item 1):
 *   Sent → Opened → Consent granted → Started → Submitted
 *
 * Each stage is CUMULATIVE — Opened is "ever opened, regardless of
 * whether the recipient progressed further." Computed from invitation
 * lifecycle timestamps (invitation.sent_at / opened_at / submitted_at)
 * for three of the four legacy stages, with one deliberate asymmetry
 * for Started (see D80 note) and one read-side stage Consent granted
 * (see D81 note). We use the timestamp form because it's stable across
 * the status transitions a row goes through (a submitted row WAS once
 * opened; opened_at remains populated).
 *
 * Revoked and expired rows are excluded from the funnel (they're
 * terminal off-paths, not in-flight failures). The denominator is the
 * count of rows with sent_at populated (i.e. "actually sent").
 *
 * Percentages are computed relative to the Sent total (the funnel
 * mouth), which is the most intuitive read: "X% of the people we
 * emailed opened the link; Y% of them granted consent; Z% started; W%
 * submitted."
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
 *
 * D81 — CONSENT GRANTED stage. Source: consent_records_redacted (security_
 * invoker view, GRANTED to authenticated; readonly admins read via the
 * underlying readonly_select RLS policy on consent_records). Logic: a
 * response that has any consent_records row counts its invitation as
 * Consent granted. The signed_at column is NOT NULL DEFAULT NOW(), so
 * mere row existence is a sufficient signal — no per-row timestamp
 * check needed. The Consent stage sits BETWEEN Opened and Started by
 * convention (consent precedes the first answer save), but the math
 * doesn't enforce ordering — a row could theoretically be Started
 * without Consent granted if a future flow shortcut consent. At
 * pilot scale this is not the case (consent is gated upstream of
 * answer saves).
 *
 * D82 — STARTED ⊆ CONSENT GRANTED. Smoke surfaced a funnel monotonicity
 * violation: pilot data showed Started=9 while Consent granted=5, which
 * is invalid (a funnel must be non-increasing left-to-right). Root cause:
 * the D80 union admits invitations whose `invitations.started_at` is
 * populated but which have no `consent_records` row (legacy / pre-
 * Session-2b data, or future flow shortcuts). After D82, the Started
 * Set is INTERSECTED with the Consent Set before the count is taken —
 * an invitation must have BOTH a started signal AND a consent record
 * to count as Started.
 *
 * Asymmetry: only Started gets the tighten. Sent / Opened / Consent /
 * Submitted are unchanged (no analogous union → narrowing). The chip
 * order Sent → Opened → Consent → Started → Submitted now reads as a
 * proper monotonic funnel by construction.
 *
 * The avgStartedProgress computation (below) iterates over the
 * TIGHTENED set so phantom-Started rows don't contribute fractions to
 * the in-flight average.
 *
 * D81 — AVG STARTED PROGRESS. For dashboard "Started: 5 (71%) avg X/Y
 * answered" treatment. Scope: invitations counted in Started but NOT
 * in Submitted (i.e. mid-flow). For each such invitation, compute
 * (non-blank answers ÷ visible non-feedback questions for variant +
 * nationality); average the per-row fractions. Returns null when no
 * mid-flow Started rows exist (the dashboard hides the bar).
 */
export type PilotFunnel = {
  sent: number;
  opened: number;
  /** D81 — count of invitations with at least one consent_records row. */
  consentGranted: number;
  started: number;
  submitted: number;
  /** Whole-number percentages of the sent total. 0 when sent is 0. */
  pctOpened: number;
  pctConsentGranted: number;
  pctStarted: number;
  pctSubmitted: number;
  /** D81 — aggregate progress for in-flight Started rows (not yet
   *  Submitted). null when no such rows exist. `pct` is whole-number
   *  averaged % (rounded). `num` / `denom` are the underlying answer +
   *  question totals across the in-flight set (NOT averaged), so the
   *  dashboard can render "X/Y answered" if it wants the raw counts
   *  instead of (or alongside) the percentage. */
  avgStartedProgress: { num: number; denom: number; pct: number } | null;
};

export async function getPilotFunnel(
  supabase: SupabaseClient<Database>,
  opts?: { versionIds?: string[] | null }
): Promise<PilotFunnel> {
  const versionIds = opts?.versionIds ?? null;

  // D80 — `id` added to the SELECT so the responses-side union below
  // can match by invitation_id.
  // D81 — also pull questionnaire_version_id + nationality for the
  // avg-started-progress denominator computation; these are non-PII
  // columns already exposed via invitations_redacted (D69 view recreate).
  // D93 — scope filter (pilot/main) on this first query; every funnel
  // stage + the consent / avg-progress reads derive from `rows`, so
  // scoping here cascades to the whole funnel. Null = no filter (All).
  let invQuery = supabase
    .from("invitations_redacted")
    .select(
      "id, status, sent_at, opened_at, started_at, submitted_at, questionnaire_version_id, nationality"
    );
  if (versionIds !== null) {
    invQuery = invQuery.in("questionnaire_version_id", versionIds);
  }
  const { data, error } = await invQuery;
  if (error) throw error;
  const rows = data ?? [];

  let sent = 0;
  let opened = 0;
  let submitted = 0;
  // D80 — invitations-side started signal feeds the Set; the responses-
  // side query below adds to the same Set so dedupe is automatic.
  const startedIds = new Set<string>();
  // D81 — collect submitted invitation_ids so we can exclude them from
  // the in-flight avg-progress denominator.
  const submittedIds = new Set<string>();
  for (const r of rows) {
    // D98 — 'pending' (bulk-created, not yet emailed) is pre-send: exclude it
    // from every funnel count, alongside the revoked/expired terminals.
    if (
      r.status === "revoked" ||
      r.status === "expired" ||
      r.status === "pending"
    )
      continue;
    if (r.sent_at) sent += 1;
    if (r.opened_at) opened += 1;
    if (r.submitted_at) {
      submitted += 1;
      if (r.id) submittedIds.add(r.id);
    }
    if (r.started_at && r.id) startedIds.add(r.id);
  }

  // D80 — supplement with responses.started_at signal. Same defensive
  // null filter as getStalledInvitations (view metadata reports id as
  // nullable; runtime non-null for active pilot rows). We scope the
  // responses query to the non-terminal candidate set so we don't pull
  // every response row in the DB — at pilot scale (~7 rows) this is
  // tiny, but at main-study scale (low hundreds) the narrowing matters.
  //
  // D81 — broaden the SELECT to (id, invitation_id, started_at) instead
  // of just invitation_id. We need response.id to map to consent rows
  // and answers for the new Consent stage + avg-progress aggregate. The
  // server-side `.not("started_at", "is", null)` filter from D80 is
  // dropped here because the consent / progress queries need responses
  // that may not yet be "started" (e.g. consent granted but no answers
  // yet). We classify started in-memory below.
  const candidates = rows.filter(
    (r) =>
      r.status !== "revoked" &&
      r.status !== "expired" &&
      r.status !== "pending" // D98 — pre-send, not part of the funnel
  );
  const candidateIds = candidates
    .map((r) => r.id)
    .filter((id): id is string => id != null);
  type RespRow = { id: string; invitation_id: string; started_at: string | null };
  let allResponses: RespRow[] = [];
  if (candidateIds.length > 0) {
    const { data: respRows, error: respErr } = await supabase
      .from("responses")
      .select("id, invitation_id, started_at")
      .in("invitation_id", candidateIds);
    if (respErr) throw respErr;
    allResponses = (respRows ?? []) as RespRow[];
    for (const r of allResponses) {
      if (r.started_at) startedIds.add(r.invitation_id);
    }
  }

  // D81 — CONSENT GRANTED count. Query consent_records_redacted scoped
  // to the candidate responses; map each consenting response_id back to
  // its invitation_id; count distinct invitations. Redacted view is
  // GRANTED to authenticated (both roles see it); signed_name_encrypted
  // is masked but signed_at is exposed (we only need existence). A
  // response with multiple consent rows is impossible (response_id is
  // UNIQUE on consent_records), but distinct-by-invitation_id below
  // also handles the multi-response-per-invitation edge if it appears.
  const consentInvIds = new Set<string>();
  if (allResponses.length > 0) {
    const allRespIds = allResponses.map((r) => r.id);
    const { data: consentRows, error: consentErr } = await supabase
      .from("consent_records_redacted")
      .select("response_id")
      .in("response_id", allRespIds);
    if (consentErr) throw consentErr;
    const respIdToInvId = new Map(
      allResponses.map((r) => [r.id, r.invitation_id])
    );
    for (const cr of consentRows ?? []) {
      const invId = cr.response_id ? respIdToInvId.get(cr.response_id) : null;
      if (invId) consentInvIds.add(invId);
    }
  }
  const consentGranted = consentInvIds.size;

  // D82 — TIGHTEN Started: the funnel must be monotonically non-
  // increasing left-to-right. Intersect the D80 union-Started Set with
  // the Consent Set so an invitation counts as Started only when BOTH
  // a started signal exists AND a consent_records row exists. Phantom-
  // Started rows (legacy / pre-Session-2b data with invitations.
  // started_at populated but no consent record) fall out of the count.
  // See the docblock above for full reasoning.
  //
  // This narrowed Set is the source of truth for the rest of getPilot
  // Funnel — `started`, `inFlightInvIds`, and the avgStartedProgress
  // iteration all read from it instead of the raw startedIds.
  const startedWithConsentIds = new Set<string>();
  for (const id of startedIds) {
    if (consentInvIds.has(id)) startedWithConsentIds.add(id);
  }

  // D81 — AVG STARTED PROGRESS for in-flight rows. Scope: invitations
  // in startedIds AND NOT in submittedIds. For each, look up its first
  // started response, count non-blank answers, divide by visible non-
  // feedback question count for (variant, nationality). Average the
  // per-row fractions.
  //
  // D82 — read from the TIGHTENED startedWithConsentIds so the avg
  // doesn't include phantom-Started rows that would otherwise skew it.
  //
  // Same denominator computation as getStalledInvitations — universal
  // questions (visible_nationalities IS NULL) + nationality-specific
  // questions for the row's nationality. Two batched queries (answers
  // + questions) keep this O(1) round-trips regardless of in-flight
  // count.
  const inFlightInvIds = Array.from(startedWithConsentIds).filter(
    (id) => !submittedIds.has(id)
  );
  const inFlightInvToResp = new Map<string, string>();
  for (const r of allResponses) {
    if (!r.started_at) continue;
    if (!startedWithConsentIds.has(r.invitation_id)) continue;
    if (submittedIds.has(r.invitation_id)) continue;
    if (inFlightInvToResp.has(r.invitation_id)) continue; // first wins
    inFlightInvToResp.set(r.invitation_id, r.id);
  }
  let avgStartedProgress: PilotFunnel["avgStartedProgress"] = null;
  if (inFlightInvIds.length > 0 && inFlightInvToResp.size > 0) {
    const inFlightRespIds = Array.from(inFlightInvToResp.values());

    // Answers — count non-blank per response.
    const { data: ansRows, error: ansErr } = await supabase
      .from("answers")
      .select("response_id, answer_text")
      .in("response_id", inFlightRespIds);
    if (ansErr) throw ansErr;
    const answeredByResp = new Map<string, number>();
    for (const a of ansRows ?? []) {
      if ((a.answer_text ?? "").trim().length > 0) {
        answeredByResp.set(
          a.response_id,
          (answeredByResp.get(a.response_id) ?? 0) + 1
        );
      }
    }

    // Questions — group by (version_id, nationality bucket). Same shape
    // as getStalledInvitations' denomByKey.
    const inFlightVersionIds = Array.from(
      new Set(
        candidates
          .filter((c) => c.id && inFlightInvToResp.has(c.id))
          .map((c) => c.questionnaire_version_id)
          .filter((v): v is string => v != null)
      )
    );
    const denomByKey = new Map<string, number>();
    if (inFlightVersionIds.length > 0) {
      const { data: qRows, error: qErr } = await supabase
        .from("questions")
        .select("version_id, is_feedback, visible_nationalities")
        .in("version_id", inFlightVersionIds)
        .eq("is_feedback", false);
      if (qErr) throw qErr;
      const universalByVersion = new Map<string, number>();
      const byKey = new Map<string, number>();
      for (const q of qRows ?? []) {
        const v = q.version_id;
        if (q.visible_nationalities === null) {
          universalByVersion.set(v, (universalByVersion.get(v) ?? 0) + 1);
        } else {
          for (const nat of q.visible_nationalities) {
            const key = `${v}|${nat}`;
            byKey.set(key, (byKey.get(key) ?? 0) + 1);
          }
        }
      }
      for (const c of candidates) {
        if (!c.id || !inFlightInvToResp.has(c.id)) continue;
        const v = c.questionnaire_version_id;
        const nat = c.nationality;
        if (!v) continue;
        const key = `${v}|${nat ?? "*"}`;
        if (denomByKey.has(key)) continue;
        const universal = universalByVersion.get(v) ?? 0;
        const natSpecific = nat ? byKey.get(`${v}|${nat}`) ?? 0 : 0;
        denomByKey.set(key, universal + natSpecific);
      }
    }

    // Average the per-row fractions. Also accumulate raw totals so the
    // dashboard can render "X/Y answered" alongside the percentage.
    let sumPct = 0;
    let count = 0;
    let totalNum = 0;
    let totalDenom = 0;
    for (const c of candidates) {
      if (!c.id || !inFlightInvToResp.has(c.id)) continue;
      const respId = inFlightInvToResp.get(c.id);
      if (!respId) continue;
      const num = answeredByResp.get(respId) ?? 0;
      const denom = c.questionnaire_version_id
        ? denomByKey.get(
            `${c.questionnaire_version_id}|${c.nationality ?? "*"}`
          ) ?? 0
        : 0;
      if (denom <= 0) continue;
      sumPct += num / denom;
      totalNum += num;
      totalDenom += denom;
      count += 1;
    }
    if (count > 0) {
      avgStartedProgress = {
        num: totalNum,
        denom: totalDenom,
        pct: Math.round((sumPct / count) * 100),
      };
    }
  }

  // D82 — `started` reflects the TIGHTENED Set so the funnel chip count
  // and the (Started/Sent) percentage both honor the Started ⊆ Consent
  // invariant.
  const started = startedWithConsentIds.size;
  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  return {
    sent,
    opened,
    consentGranted,
    started,
    submitted,
    pctOpened: pct(opened),
    pctConsentGranted: pct(consentGranted),
    pctStarted: pct(started),
    pctSubmitted: pct(submitted),
    avgStartedProgress,
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
