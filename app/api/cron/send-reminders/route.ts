// app/api/cron/send-reminders/route.ts
//
// D64 STEP 7 (Path B locked) — daily auto-nudge cron. Dispatches
// reminder1 (~7 days after sent_at) and reminderFinal (~14 days after
// sent_at) reminder emails to invitations that haven't been submitted
// yet, then stamps the corresponding reminder*_sent_at column so the
// next run is idempotent.
//
// Hit at 0 12 * * * UTC by Vercel Cron (see vercel.json). Hobby plan
// has within-the-hour precision; Pro has exact-minute. The schedule is
// the SAME across plans — the precision delta is the only difference,
// and it doesn't matter for a daily nudge.
//
// PATH B — REMINDERS REUSE, DON'T ROTATE
// --------------------------------------
// The reminder email reuses the EXISTING invitation token, decrypted
// from invitations.token_plaintext_encrypted (D64 STEP 6.5 column).
// The original invitation email's link STAYS ALIVE across the reminder
// cycle. The reminder is just a re-send of the same URL.
//
// Token rotation only happens on EXPLICIT resend (resendInvitationAction)
// or revoke. If a future change makes reminders rotate, audit
// downstream UX — the original invitation email's link would die the
// moment reminder1 fires, which would surprise recipients.
//
// AUTHENTICATION
// --------------
// Vercel Cron POSTs an Authorization: Bearer <CRON_SECRET> header. We
// EXACT-MATCH the full "Bearer <secret>" string and return 401 on any
// mismatch. NO substring/split — defends against header-smuggling
// (extra spaces, lowercase variants). No logging of the failed-auth
// request — it could be an attacker probe with malicious headers/body.
//
// IDEMPOTENCY (by-design, NOT by-retry-suppression)
// -------------------------------------------------
// Vercel's own docs say cron "may fire more than once for the same
// schedule" and offers NO retry suppression. The candidate query
// already excludes rows where the corresponding reminder*_sent_at IS
// NOT NULL, so a successful send→stamp from a previous run filters the
// row out of the next run automatically. We stamp the column POST-OK
// (one atomic UPDATE alongside last_send_failed_at: null), so there is
// no observable half-state to a concurrent run.
//
// On send FAILURE we deliberately do NOT stamp the reminder column —
// the row stays a candidate for the next run, which is the retry path.
// last_send_failed_at stamps so the chip on /admin/invitations
// surfaces the issue to Sura even if she misses the daily report.
//
// TWO QUERIES, NOT ONE-WITH-OR
// ----------------------------
// The reminder1 and reminderFinal candidate sets have different column
// predicates (the IS NULL column + the sent_at cutoff). Combining them
// via OR would compute both sets, then post-filter; two narrow queries
// are clearer to read AND let PG plan each independently.
//
// PRE-D64 ROW GATE
// ----------------
// Both candidate queries also filter `token_plaintext_encrypted IS NOT
// NULL`. Pre-D64 invitations have NULL in that column (the column
// didn't exist at their create time and there's no cryptographic path
// from token_hash back to plaintext, so we can't backfill). Excluding
// them prevents the cron from sending a reminder it can't compose a
// URL for. Sura's manual resend (which rotates + populates the column
// on the way through) is the recovery path for pre-D64 rows that need
// nudging.
//
// WITHDRAW NON-CASCADE (D63) DEFENSE
// ----------------------------------
// The status IN ('sent', 'opened') gate is LOAD-BEARING for the D63
// withdraw non-cascade. A submitted-then-withdrawn invitation keeps
// invitations.status='submitted' (D63 deliberately does NOT cascade
// response.status='withdrawn' to invitations.status). Since 'submitted'
// is NOT in this gate, withdrawn invitations are correctly excluded
// from reminders — no separate "skip if any response is withdrawn"
// check needed. 'started' is also out by design: a respondent who began
// answering doesn't need a nudge. Reminders target the un-engaged
// middle (sent-but-not-opened, or opened-but-not-started).
//
// If a future change makes withdraw cascade to invitations.status,
// re-evaluate this gate.
//
// OPTION A — resend preserves reminder stamps
// -------------------------------------------
// A resendInvitationAction (Sura's manual nudge) bumps sent_at AND
// preserves reminder1_sent_at / reminder_final_sent_at. So a row that
// has reminder1_sent_at != NULL after a resend stays "above" the
// reminder1 gate — this loop does NOT re-trigger an auto-cycle for
// the same row. Sura's resend is the manual nudge; a fresh auto-cycle
// requires revoke + create-new (new ref_code → new row → clean state).
//
// PII DISCIPLINE
// --------------
// - Decrypted recipient_email is scoped to a single loop iteration.
//   Same for decrypted token plaintext. Both go into Resend's `to` /
//   the email body's CTA URL respectively, then fall out of scope at
//   return. NEVER logged, NEVER in the response JSON, NEVER in
//   audit_log metadata.
// - The response JSON contains only the four counter numbers. No
//   refCode list, no IDs, no per-row breakdown, no errorClass
//   distribution.
// - audit_log writes via logSystemEmailFailure: severity='warn',
//   metadata = { invitationId, kind, errorClass } only.
// - console.error lines log refCode + kind + errorClass. NEVER the
//   recipient address, NEVER raw Resend error.message (which can echo
//   the recipient under some SDK failure modes), NEVER the token URL.
//
// PER-ROW ISOLATION
// -----------------
// Every per-row operation is wrapped in try/catch. ONE bad row (a
// decrypt failure, an unexpected RPC throw, an SDK glitch) must NOT
// kill the whole batch — the loop continues to the next candidate. A
// catchable row throw is counted as `failed` and audited as
// errorClass='config'.

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendReminderEmail, type ReminderKind } from "@/lib/email/reminder";
import { logSystemEmailFailure } from "@/lib/audit";
import type { Database } from "@/lib/supabase/database.types";

type InvitationUpdate = Database["public"]["Tables"]["invitations"]["Update"];

// 3-line snake_case ↔ mixed-case translation map. Single source of truth
// for the kind → column mapping; if you add a third reminder later,
// extend here + REMINDER_DAYS below + the wrapper's discriminator.
const REMINDER_COLUMN: Record<
  ReminderKind,
  "reminder1_sent_at" | "reminder_final_sent_at"
> = {
  reminder1: "reminder1_sent_at",
  reminderFinal: "reminder_final_sent_at",
};

const REMINDER_DAYS: Record<ReminderKind, number> = {
  reminder1: 7,
  reminderFinal: 14,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Force node runtime (consistency with the rest of the API surface;
// also some Supabase SDK paths prefer node). Disable static
// optimisation — side-effecting handler.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function GET(request: Request): Promise<Response> {
  // ── 1. AUTH ──────────────────────────────────────────────────────
  // Exact-match on the full "Bearer <secret>" header. No
  // substring/split, no lowercase normalisation. Return 401 on any
  // mismatch (per Vercel Cron docs). Do NOT log headers / body — could
  // be an attacker probe.
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || !auth || auth !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. PRE-FLIGHT CONFIG ────────────────────────────────────────
  // Bail early if the deploy is missing keys the per-row loop will
  // need. Return 500 with a generic body — don't leak which key is
  // missing (audit-log unfriendliness, plus minor info-disclosure).
  // console.error has the specifics for Sura/Saeed.
  //
  // NEXT_PUBLIC_SITE_URL is needed to compose `${SITE_URL}/r/<token>`
  // for each reminder email's CTA URL.
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[cron] RESEND_API_KEY missing — aborting reminder run");
    return new Response("Server misconfigured", { status: 500 });
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    console.error(
      "[cron] NEXT_PUBLIC_SITE_URL missing — aborting reminder run"
    );
    return new Response("Server misconfigured", { status: 500 });
  }
  // Normalise: trim trailing slashes so URL composition is clean.
  const siteUrlNoSlash = siteUrl.replace(/\/+$/, "");

  const admin = createSupabaseAdminClient();

  // ── 3. DISPATCH BOTH KINDS ──────────────────────────────────────
  // Two sequential dispatches (not parallel): the second can read the
  // committed state of the first — relevant if a row qualifies for
  // BOTH reminders on the same day (e.g., 14d since sent_at, neither
  // stamp set, possible after a cron pause/backfill). reminder1 fires
  // first; reminderFinal's query then sees the same row but the
  // gate is on reminder_final_sent_at — which is still NULL — so the
  // same row would receive BOTH reminders on the same day. Sequential
  // ordering keeps that deterministic if it happens.
  const r1 = await dispatchKind(admin, "reminder1", siteUrlNoSlash);
  const rf = await dispatchKind(admin, "reminderFinal", siteUrlNoSlash);

  // ── 4. RESPONSE ─────────────────────────────────────────────────
  // PII-free body. Four numbers. No refCode list, no IDs, no
  // errorClass distribution, no recipient data. Sura's audit-log view
  // is where she'd drill into per-row failures.
  return Response.json({
    reminder1: { sent: r1.sent, failed: r1.failed },
    reminderFinal: { sent: rf.sent, failed: rf.failed },
  });
}

// ─────────────────────────────────────────────────────────────────
// dispatchKind — query candidates + dispatch each
// ─────────────────────────────────────────────────────────────────

async function dispatchKind(
  admin: AdminClient,
  kind: ReminderKind,
  siteUrlNoSlash: string
): Promise<{ sent: number; failed: number }> {
  const column = REMINDER_COLUMN[kind];
  const days = REMINDER_DAYS[kind];
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const nowIso = new Date().toISOString();

  // Candidate query. See header for the load-bearing rationale on each
  // predicate. Selecting the minimum columns we need — both the
  // recipient AND the token ciphertexts are required (per-row decrypt
  // inside the loop), but neither escapes this function's scope.
  const { data: candidates, error: queryErr } = await admin
    .from("invitations")
    .select(
      "id, ref_code, preferred_language, expires_at, recipient_email_encrypted, token_plaintext_encrypted"
    )
    .in("status", ["sent", "opened"])
    .lte("sent_at", cutoff)
    .is(column, null)
    .not("token_plaintext_encrypted", "is", null) // Path B — exclude pre-D64 rows
    .gt("expires_at", nowIso);

  if (queryErr) {
    console.error(
      "[cron]",
      kind,
      "candidate query failed —",
      queryErr.message
    );
    // No audit row for a query failure — there's no per-row context to
    // attach it to. The console log + Vercel function alert is the
    // forensic surface.
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const row of candidates ?? []) {
    try {
      const ok = await dispatchOne(admin, row, kind, siteUrlNoSlash);
      if (ok) sent++;
      else failed++;
    } catch (rowErr) {
      // Per-row isolation: an unexpected throw must not kill the
      // batch. Best-effort audit with errorClass='config' (an
      // unhandled throw is by definition a config-class issue from
      // the cron's POV).
      failed++;
      console.error(
        "[cron]",
        kind,
        "row threw for",
        row.ref_code,
        "errorClass=config",
        (rowErr as Error).message
      );
      try {
        await logSystemEmailFailure("invitation.email_failed", {
          resource: row.ref_code,
          metadata: {
            invitationId: row.id,
            kind,
            errorClass: "config",
          },
        });
      } catch {
        // Even the audit-write hiccup must not kill the batch.
      }
    }
  }

  return { sent, failed };
}

// ─────────────────────────────────────────────────────────────────
// dispatchOne — single-row send + commit decision
// ─────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  ref_code: string;
  preferred_language: string; // narrowed below
  expires_at: string;
  recipient_email_encrypted: string;
  token_plaintext_encrypted: string | null;
};

async function dispatchOne(
  admin: AdminClient,
  row: Candidate,
  kind: ReminderKind,
  siteUrlNoSlash: string
): Promise<boolean> {
  // a. Decrypt recipient email. Scope is THIS function — `email` is
  //    handed to Resend and falls out of scope at return. NEVER
  //    logged, NEVER in audit metadata, NEVER in the response.
  const { data: email, error: decryptEmailErr } = await admin.rpc(
    "decrypt_pii",
    { p_ciphertext: row.recipient_email_encrypted }
  );
  if (decryptEmailErr || !email) {
    console.error(
      "[cron]",
      kind,
      "decrypt(email) failed for",
      row.ref_code,
      "errorClass=config"
    );
    await markFailure(admin, row, kind, "config");
    return false;
  }

  // b. Decrypt the plaintext token (Path B). Same Vault key, same RPC
  //    pattern as the recipient email — the column was populated at
  //    create / rotation time (D64 STEP 6.6). The query gated on IS
  //    NOT NULL so the column SHOULD be non-null here; if it's null
  //    against expectations, fail-config rather than dereference.
  //
  //    Same scope discipline: `tokenPlaintext` is local, goes into
  //    the URL handed to sendReminderEmail, falls out of scope at
  //    return. NEVER logged, NEVER audited.
  if (!row.token_plaintext_encrypted) {
    // Defence in depth — the candidate query already excludes NULL.
    console.error(
      "[cron]",
      kind,
      "missing token_plaintext_encrypted (post-query)",
      row.ref_code,
      "errorClass=config"
    );
    await markFailure(admin, row, kind, "config");
    return false;
  }
  const { data: tokenPlaintext, error: decryptTokenErr } = await admin.rpc(
    "decrypt_pii",
    { p_ciphertext: row.token_plaintext_encrypted }
  );
  if (decryptTokenErr || !tokenPlaintext) {
    console.error(
      "[cron]",
      kind,
      "decrypt(token) failed for",
      row.ref_code,
      "errorClass=config"
    );
    await markFailure(admin, row, kind, "config");
    return false;
  }

  // c. Compose the reminder URL — same shape as buildInvitationUrl
  //    (lib/tokens.ts): `${SITE_URL}/r/<plaintext>`. We don't reuse
  //    buildInvitationUrl directly because it reads NEXT_PUBLIC_SITE_URL
  //    each call; the cron's pre-flight already validated + cached the
  //    base, and threading that through is cleaner than re-reading env
  //    inside the loop.
  const tokenUrl = `${siteUrlNoSlash}/r/${tokenPlaintext}`;

  // d. Try the send. Wrapper returns EmailSendResult; throws on
  //    missing RESEND_API_KEY (should never happen — pre-flight
  //    catches that — but defensive).
  let result;
  try {
    result = await sendReminderEmail({
      to: email,
      lang: row.preferred_language as "en" | "ar",
      // ^ DB CHECK on invitations.preferred_language enforces 'en' | 'ar';
      //   gen types report `string`. Same narrowing as app/r/[token]/route.ts.
      refCode: row.ref_code,
      tokenUrl,
      expiresAt: row.expires_at,
      kind,
    });
  } catch {
    console.error(
      "[cron]",
      kind,
      "wrapper threw for",
      row.ref_code,
      "errorClass=config"
    );
    await markFailure(admin, row, kind, "config");
    return false;
  }

  // e. Resend layer failure (or wrapper config gate, e.g. missing
  //    locale defaults). Stamp last_send_failed_at + audit; missing
  //    reminder*_sent_at stamp leaves the row in the candidate set
  //    for the next cron run.
  if (!result.ok) {
    console.error(
      "[cron]",
      kind,
      "send failed for",
      row.ref_code,
      "errorClass=" + result.errorClass
    );
    await markFailure(admin, row, kind, result.errorClass);
    return false;
  }

  // f. Success. Commit the reminder stamp + clear of
  //    last_send_failed_at in ONE UPDATE. Atomic at the row level
  //    (PG applies multi-column updates atomically), so a concurrent
  //    cron run (Vercel's "may fire more than once") never sees a
  //    half-state.
  //
  //    NOT touched here:
  //      - token_hash + token_plaintext_encrypted: Path B locked, no
  //        rotation. The token columns stay exactly as createInvitation /
  //        resendInvitation last wrote them.
  //      - sent_at: Option A locked, the sent_at anchor reflects the
  //        ORIGINAL invitation send (or Sura's last manual resend) and
  //        stays fixed across auto-reminder dispatches.
  //
  //    Per-kind explicit literal (not a computed [column] key) because
  //    the supabase-js generated Update type rejects index signatures —
  //    same shape, branched once for the type system.
  const stampedNow = new Date().toISOString();
  const updatePayload: InvitationUpdate =
    kind === "reminder1"
      ? {
          reminder1_sent_at: stampedNow,
          last_send_failed_at: null,
        }
      : {
          reminder_final_sent_at: stampedNow,
          last_send_failed_at: null,
        };
  const { error: updateErr } = await admin
    .from("invitations")
    .update(updatePayload)
    .eq("id", row.id);

  if (updateErr) {
    // Edge: Resend accepted but the DB commit failed. The recipient
    // gets the reminder email with the (existing) URL — the URL still
    // works because we DIDN'T rotate the token. Net effect: a duplicate
    // send on the next cron run if the column write doesn't recover
    // before then. Acceptable degradation; less harmful than Path A
    // (where the equivalent edge produced a dead URL in the email).
    // Loud log + counted as failed; the next cron run will retry.
    console.error(
      "[cron]",
      kind,
      "POST-OK commit failed for",
      row.ref_code,
      "—",
      updateErr.message
    );
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────
// markFailure — last_send_failed_at stamp + audit row
// ─────────────────────────────────────────────────────────────────

async function markFailure(
  admin: AdminClient,
  row: Candidate,
  kind: ReminderKind,
  errorClass: "send" | "config"
): Promise<void> {
  const nowIso = new Date().toISOString();
  // Column write + audit, each wrapped — we're already in error-
  // recovery; one writing while the other failed is acceptable noise.
  try {
    await admin
      .from("invitations")
      .update({ last_send_failed_at: nowIso })
      .eq("id", row.id);
  } catch (colErr) {
    console.error(
      "[cron]",
      kind,
      "last_send_failed_at write failed for",
      row.ref_code,
      (colErr as Error).message
    );
  }
  try {
    await logSystemEmailFailure("invitation.email_failed", {
      resource: row.ref_code,
      metadata: {
        invitationId: row.id,
        kind,
        errorClass,
      },
    });
  } catch (auditErr) {
    console.error(
      "[cron]",
      kind,
      "email_failed audit write failed for",
      row.ref_code,
      (auditErr as Error).message
    );
  }
}
