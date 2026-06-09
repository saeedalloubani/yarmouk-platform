// app/api/cron/drain-bulk-invites/route.ts
//
// D99 — bulk-invite SEND layer. Every-minute cron that drains ONE pending
// invitation per run (Sura's locked one-per-minute pacing — maximally safe
// against Resend's ~2 req/sec limit). Pending rows are created by D98's
// bulkCreateInvitationsAction (status='pending', sendEmail OFF); this cron
// emails them — reusing the SINGLE-INVITE send primitive (sendInvitationEmail,
// the first-contact template) — and flips pending -> sent.
//
// MIRRORS THE REMINDER CRON (app/api/cron/send-reminders/route.ts):
//   - same CRON_SECRET exact-match auth (401 on mismatch, no logging)
//   - same pre-flight (RESEND_API_KEY + NEXT_PUBLIC_SITE_URL → 500)
//   - same service-role admin client (no JWT in a cron)
//   - same decrypt-to-send recipe (decrypt_pii on email/token/code/name,
//     compose ${SITE_URL}/r/<token>, send)
//   - same failure isolation: on send failure, leave the row in the pending
//     pool (re-qualifies next tick) + stamp last_send_failed_at +
//     logSystemEmailFailure. Never throws out of the loop.
//   - same PII discipline: decrypted values scoped to this request, NEVER
//     logged / audited / returned. Response JSON = a tiny non-PII status.
//
// *** DOUBLE-SEND-PROOF (the one place this diverges from the tolerant
//     reminder cron) ***
// A row that has been sent must NEVER be re-sent — even if two runs overlap,
// a run retries, or the cron fires twice for one tick. The claim is an atomic
// COMPARE-AND-SWAP:
//
//     UPDATE invitations SET status='sent', sent_at=now()
//       WHERE id = <oldest pending id> AND status='pending'
//       RETURNING id
//
// PG row-locks the row, so two concurrent claims serialise: whichever commits
// first flips status to 'sent'; the other's `AND status='pending'` predicate
// then matches ZERO rows → it returns null → it does NOT send. A row already
// 'sent' (or progressed to opened/started/submitted, or revoked) is never even
// selected (the candidate query filters status='pending'). So a given row is
// claimed — and therefore sent — at most once.
//
// We claim-to-'sent' BEFORE sending (not after) precisely so the CAS guards
// the send. On send FAILURE we REVERT status -> 'pending' (+ sent_at NULL,
// + last_send_failed_at) so the row retries next tick, honoring the brief's
// "failure leaves it pending" rule. The only residual duplicate path is a
// Resend FALSE NEGATIVE (it delivered but reported an error) → revert → resend:
// that is inherent to any at-least-once mail system and matches the reminder
// cron's documented, accepted trade-off. Concurrency / overlap / retry CANNOT
// double-send by construction. The crash-between-claim-and-send edge yields a
// lost send (stuck 'sent', no email), NOT a double send — the correct priority
// when "a real participant gets the same invite twice" is the stated worst case.

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { logSystemEmailFailure } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PendingRow = {
  id: string;
  ref_code: string;
  preferred_language: string;
  expires_at: string;
  recipient_email_encrypted: string;
  recipient_name_encrypted: string | null;
  token_plaintext_encrypted: string | null;
  access_code_encrypted: string | null;
};

export async function GET(request: Request): Promise<Response> {
  // ── 1. AUTH — exact-match the full Bearer header (mirror reminder cron).
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || !auth || auth !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. PRE-FLIGHT — bail before claiming a row we couldn't send.
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[drain] RESEND_API_KEY missing — aborting run");
    return new Response("Server misconfigured", { status: 500 });
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    console.error("[drain] NEXT_PUBLIC_SITE_URL missing — aborting run");
    return new Response("Server misconfigured", { status: 500 });
  }
  const siteUrlNoSlash = siteUrl.replace(/\/+$/, "");
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // ── 3. FIND the oldest sendable pending row. token + access_code must be
  //      present (D98 always mints them; defensive parity with reminder cron)
  //      and the invitation must still be valid (expires_at in the future).
  const { data: cand, error: selErr } = await admin
    .from("invitations")
    .select(
      "id, ref_code, preferred_language, expires_at, recipient_email_encrypted, recipient_name_encrypted, token_plaintext_encrypted, access_code_encrypted"
    )
    .eq("status", "pending")
    .not("token_plaintext_encrypted", "is", null)
    .not("access_code_encrypted", "is", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selErr) {
    console.error("[drain] candidate query failed —", selErr.message);
    return Response.json({ drained: 0, failed: 0, note: "query_error" });
  }
  if (!cand) {
    return Response.json({ drained: 0, failed: 0, note: "no_pending" });
  }
  const row = cand as PendingRow;

  // ── 4. ATOMIC CLAIM (compare-and-swap). Flip pending -> sent ONLY if still
  //      pending. A losing concurrent run gets `claimed === null` → no send.
  const { data: claimed, error: claimErr } = await admin
    .from("invitations")
    .update({ status: "sent", sent_at: nowIso, last_send_failed_at: null })
    .eq("id", row.id)
    .eq("status", "pending") // ← the guard that makes double-send impossible
    .select("id")
    .maybeSingle();

  if (claimErr) {
    console.error("[drain] claim update failed for", row.ref_code, "—", claimErr.message);
    return Response.json({ drained: 0, failed: 0, note: "claim_error" });
  }
  if (!claimed) {
    // Another run claimed it between our SELECT and UPDATE — not our row.
    return Response.json({ drained: 0, failed: 0, note: "claim_lost" });
  }

  // ── 5. DECRYPT + SEND. Any failure REVERTS the claim (back to pending) so
  //      the next tick retries. Decrypted values are scoped to this block.
  const { data: email, error: e1 } = await admin.rpc("decrypt_pii", {
    p_ciphertext: row.recipient_email_encrypted,
  });
  if (e1 || !email) return revert(admin, row, "config", "decrypt(email)");

  if (!row.token_plaintext_encrypted) {
    return revert(admin, row, "config", "missing token (post-claim)");
  }
  const { data: token, error: e2 } = await admin.rpc("decrypt_pii", {
    p_ciphertext: row.token_plaintext_encrypted,
  });
  if (e2 || !token) return revert(admin, row, "config", "decrypt(token)");

  if (!row.access_code_encrypted) {
    return revert(admin, row, "config", "missing access_code (post-claim)");
  }
  const { data: code, error: e3 } = await admin.rpc("decrypt_pii", {
    p_ciphertext: row.access_code_encrypted,
  });
  if (e3 || !code) return revert(admin, row, "config", "decrypt(access_code)");

  // Name is NON-FATAL (allowed-only {name} interpolation) — degrade to "".
  let name: string | null = null;
  if (row.recipient_name_encrypted) {
    const { data: nameDec, error: eN } = await admin.rpc("decrypt_pii", {
      p_ciphertext: row.recipient_name_encrypted,
    });
    if (!eN && typeof nameDec === "string") name = nameDec;
  }

  const tokenUrl = `${siteUrlNoSlash}/r/${token}`;

  let result;
  try {
    result = await sendInvitationEmail({
      to: email,
      lang: row.preferred_language as "en" | "ar",
      refCode: row.ref_code,
      tokenUrl,
      expiresAt: row.expires_at,
      accessCode: code,
      name,
    });
  } catch {
    return revert(admin, row, "config", "send wrapper threw");
  }

  if (!result.ok) {
    // Includes Resend 429 — the wrapper collapses it to { ok:false,
    // errorClass:'send' } (it does NOT throw). Revert → next tick retries.
    return revert(admin, row, result.errorClass, "send failed");
  }

  // ── 6. SUCCESS. The row is already status='sent' + sent_at (set at claim).
  //      Nothing more to write. PII-clean response.
  return Response.json({ drained: 1, failed: 0 });
}

// ─────────────────────────────────────────────────────────────────
// revert — undo the claim so the row retries next tick + record failure
// ─────────────────────────────────────────────────────────────────
//
// Flips the just-claimed row back to 'pending' (clears sent_at, stamps
// last_send_failed_at → drives the /admin/invitations "send failed" chip),
// and writes a NON-PII audit row. Each write is wrapped — we're already in
// error recovery; a secondary hiccup must not mask the original failure.
// NEVER logs the recipient address or raw error.message.
async function revert(
  admin: AdminClient,
  row: PendingRow,
  errorClass: "send" | "config",
  reason: string
): Promise<Response> {
  const nowIso = new Date().toISOString();
  try {
    await admin
      .from("invitations")
      .update({
        status: "pending",
        sent_at: null,
        last_send_failed_at: nowIso,
      })
      .eq("id", row.id);
  } catch (colErr) {
    console.error(
      "[drain] revert-to-pending failed for",
      row.ref_code,
      (colErr as Error).message
    );
  }
  try {
    await logSystemEmailFailure("invitation.email_failed", {
      resource: row.ref_code,
      metadata: { invitationId: row.id, kind: "bulk_drain", errorClass },
    });
  } catch {
    // audit hiccup must not mask the send failure
  }
  console.error(
    "[drain] send failed for",
    row.ref_code,
    "errorClass=" + errorClass,
    "(" + reason + ") — reverted to pending for retry"
  );
  return Response.json({ drained: 0, failed: 1 });
}
