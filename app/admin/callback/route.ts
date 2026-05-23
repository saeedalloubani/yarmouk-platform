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
      return NextResponse.redirect(`${origin}/admin`);
    }
    console.error("[admin/callback] verifyOtp failed", error);
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
