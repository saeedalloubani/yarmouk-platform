// app/admin/callback/route.ts
//
// Magic-link landing (UNGUARDED). The email link points here with
// ?token_hash=…&type=email; we verify it (verifyOtp) to establish a session
// (cookies set by the server client) and redirect into /admin, where the
// (protected) layout runs the authorization decision tree.
//
// On any failure — or missing params — we send the user to
// /admin/login?error=auth, never to the protected area without a session.
//
// ─────────────────────────────────────────────────────────────────────────
// LEGACY (D65) — Replaced by 6-digit OTP code at /admin/login.
//
// As of D65 (2026-06), the Supabase Magic Link email template renders
// the 6-digit code as text rather than a clickable URL. New admin
// sign-ins enter the code into /admin/login state 2 (enter_code), which
// calls verifyOtpAction (Server Action in lib/actions/admin-auth.ts).
// This route is kept for BACKWARD COMPATIBILITY — any email sent BEFORE
// the template change still has a clickable URL pointing here, and that
// URL still resolves correctly. Remove in a future decision after the
// migration window closes (the magic-link token TTL is ~60 minutes, so
// the window is naturally short).
//
// WHY THE SWITCH: Microsoft 365 Defender / Outlook prefetches URLs in
// emails (link-scanning for malicious destinations), consuming the
// single-use OTP token before the user can click. Audit log pattern
// confirmed in prod: 8+ parallel verify_failed events per single
// magic-link request for sjkarasneh24@eng.just.edu.jo. A URL-less email
// (text-rendered code) defeats the prefetch.
//
// NOT TOUCHED: the participant invitation/reminder /r/<token> flow has
// the SAME vulnerability waiting for any future O365-domain pilot
// participant. Out of D65 scope; tracked as backlog (see RUNBOOK
// "Admin login — OTP code flow (D65)" / TASK_STATE OTHER OPEN).
// ─────────────────────────────────────────────────────────────────────────
//
// ─────────────────────────────────────────────────────────────────────────
// WHY token_hash + verifyOtp (NOT PKCE code-exchange):
// We originally used the default {{ .ConfirmationURL }} → ?code= link +
// supabase.auth.exchangeCodeForSession(code). @supabase/ssr stores the PKCE
// code-verifier in a cookie shared with this server route; in PRODUCTION that
// cookie did NOT survive the round-trip, so the exchange failed and login
// bounced to /admin/login?error=auth. We switched to the token_hash flow
// (no verifier needed):
//   1. Dashboard → Authentication → Email Templates → Magic Link: set the
//      link to
//        {{ .SiteURL }}/admin/callback?token_hash={{ .TokenHash }}&type=email
//   2. Here, read token_hash + type and call:
//        await supabase.auth.verifyOtp({ type, token_hash })
// Recorded in RUNBOOK.md "Admin auth bootstrap" / "PKCE fallback".
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit, logFailedLogin } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) {
      // Success — a session now exists, so audit via the AUTHENTICATED path:
      // the fill-actor trigger attributes the real admin (actor_admin_id /
      // actor_name / actor_role) from auth.jwt() on this same request. We log
      // NO email here — actor_* already identifies who logged in, and the
      // metadata-no-email contract stays clean. Best-effort wrap so a
      // near-impossible audit hiccup can't block an otherwise-valid login.
      try {
        await logAudit(supabase, {
          action: "admin.login",
          severity: "info",
          metadata: { via: "magic_link" },
        });
      } catch (err) {
        console.error("[admin/callback] login audit failed", err);
      }
      return NextResponse.redirect(`${origin}/admin`);
    }
    // Bad / expired / tampered link — no session. Service-role failure write
    // (no email is recoverable from token_hash).
    console.error("[admin/callback] verifyOtp failed", error);
    await logFailedLogin("verify_failed");
  } else {
    // Link reached the callback without the required params.
    await logFailedLogin("missing_params");
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
