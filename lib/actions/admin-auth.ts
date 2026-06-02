"use server";

// lib/actions/admin-auth.ts
//
// D65 — Admin login OTP code flow (Server Action). Verifies the 6-digit
// code Sura types into /admin/login state 2 (enter_code). Server-side
// verifyOtp call so session cookies are written by @supabase/ssr's
// server client via next/headers — same proven path /admin/callback uses
// for the legacy magic-link flow.
//
// WHY A SERVER ACTION (not browser-side verifyOtp):
//
// /admin/callback's server-side verifyOtp has been writing session
// cookies reliably in production since the PKCE-cookie fix (see
// app/admin/callback/route.ts header comment). Browser-side verifyOtp
// would introduce a NEW cookie-write path via the @supabase/ssr
// browser-client adapter (document.cookie) that we haven't validated
// against Vercel-edge constraints. The PKCE history in /admin/callback
// shows that path has been load-bearing-but-fragile in this environment.
// Mirroring the proven server path keeps D65 within known-good
// territory.
//
// PII discipline (carries D63 / D64 / D65 forward):
//
//   - The `email` argument is used ONLY to call verifyOtp. Never logged,
//     never persisted to audit metadata. The audit row's actor_admin_id /
//     actor_name / actor_role get filled by tg_audit_log_fill_actor from
//     auth.jwt() AFTER verifyOtp succeeds — same automatic-attribution
//     path /admin/callback uses, no email reaches the row.
//
//   - The `code` argument (6-digit OTP) is consumed by verifyOtp and
//     discarded. Never logged, never in audit metadata.
//
//   - The failure path uses logFailedLogin("verify_failed") — the narrow
//     unauthenticated audit helper (service-role direct insert, hard-
//     coded action + severity, no metadata leak surface).
//
// On success: redirect("/admin"). Next.js's redirect() throws
// NEXT_REDIRECT; the framework's Server Action handler catches it and
// triggers a client-side navigation. The return type's { ok: true }
// branch is unreachable from the client (defensive type only).
//
// SHOULDCREATEUSER:FALSE — enforced upstream by the browser-side
// signInWithOtp call in /admin/login state 1. verifyOtp itself doesn't
// take the flag, but a code can only be issued if signInWithOtp
// succeeded under shouldCreateUser:false, so D49's lockdown still holds.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit, logFailedLogin } from "@/lib/audit";

/** Result shape for verifyOtpAction. The `ok: true` branch is
 *  unreachable from a client component — the action redirects before
 *  returning. The branch exists only to satisfy TS exhaustiveness if a
 *  future caller awaits the action without a redirect. */
export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; error: "invalid_or_expired" };

/**
 * Verify a 6-digit OTP code for admin sign-in. Returns
 * { ok: false, error } on failure (UI shows generic "Invalid or expired
 * code…" message). On success, calls redirect("/admin") which throws
 * NEXT_REDIRECT — the client-side action handler triggers a navigation.
 *
 * No email, no code, no Supabase error.message ever reaches the audit
 * log or any console output beyond the bucket name.
 */
export async function verifyOtpAction(
  email: string,
  code: string
): Promise<VerifyOtpResult> {
  // Defensive server-side shape check (the client also validates).
  // A malformed code or email returns the SAME generic error as a
  // real verifyOtp failure — preserves no-enumeration discipline
  // (D50): the caller can't distinguish "you typed garbage" from
  // "the code was wrong" from "this email isn't authorized."
  if (!/^\d{6}$/.test(code) || !email.includes("@")) {
    return { ok: false, error: "invalid_or_expired" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    // 'email' is the verifyOtp type for the 6-digit code mode
    // (vs 'magiclink' for clickable URL tokens — but the same
    // signInWithOtp emit covers both; the email template renders
    // either the code or the URL based on what {{ … }} variables it
    // uses).
    type: "email",
  });

  if (error) {
    // No session — failure path. Mirror /admin/callback's verify_failed
    // branch: log via the narrow unauthenticated helper, return a
    // generic typed error to the client. NO email reaches metadata.
    console.error("[admin-auth] verifyOtp failed");
    await logFailedLogin("verify_failed");
    return { ok: false, error: "invalid_or_expired" };
  }

  // Success — a session exists. Audit via the AUTHENTICATED path so
  // tg_audit_log_fill_actor attributes the real admin from auth.jwt()
  // on this same request. Best-effort wrap so a near-impossible audit
  // hiccup can't block a valid login.
  try {
    await logAudit(supabase, {
      action: "admin.login",
      severity: "info",
      // The actor identity (admin_id / name / role) fills via the
      // BEFORE-INSERT trigger from auth.jwt(). Metadata stays minimal:
      // just the channel marker for forensic differentiation between
      // OTP-code logins (D65) and any legacy magic-link logins that
      // resolve through /admin/callback during the transition window.
      metadata: { via: "otp_code" },
    });
  } catch (auditErr) {
    console.error("[admin-auth] login audit failed", auditErr);
  }

  // Throws NEXT_REDIRECT — Next.js's Server Action handler catches it
  // and triggers a client-side navigation to /admin. The middleware
  // then sees the new session cookies and the (protected) layout
  // runs the role check.
  redirect("/admin");
}
