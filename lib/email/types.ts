// lib/email/types.ts
//
// D64 — shared return shape for all email wrappers in lib/email/*. The
// widening to a discriminated union (was `{ ok: boolean }` per wrapper)
// lets the caller bucket failures into 'send' vs 'config' for the
// audit_log + last_send_failed_at column writes — WITHOUT carrying
// Resend's raw error.message into persistent storage (its strings can
// echo the recipient address).
//
// All 4 wrappers (invitation, reminder, admin-invite, submission)
// return EmailSendResult. The invitation + reminder caller paths
// additionally drive the invitations.last_send_failed_at column;
// admin-invite + submission do not (no invitation row to write to —
// admin-invite is admins-row-bound, submission has no invitation_id).

/** Failure bucket. Single value across all wrappers so audit metadata
 *  stays uniform and Sura can filter on it.
 *
 *  - 'send'   = Resend returned an error OR threw mid-call (rate
 *               limit, bad recipient, transient API issue, etc.).
 *               error.message from Resend MAY echo the recipient —
 *               we throw it away and only record the bucket.
 *  - 'config' = wrapper rejected BEFORE reaching Resend — missing
 *               href, missing locale defaults, OR the caller caught
 *               a missing-RESEND_API_KEY throw. Recoverable: a
 *               deploy or input fix unblocks the next send.
 *
 *  NEVER carries the raw error.message. */
export type EmailErrorClass = "send" | "config";

/** Discriminated union for all sendXxxEmail wrappers. The caller
 *  narrows via `sent.ok` — `errorClass` is only accessible in the
 *  `!sent.ok` branch (which is exactly where the audit + chip writes
 *  belong). */
export type EmailSendResult =
  | { ok: true }
  | { ok: false; errorClass: EmailErrorClass };
