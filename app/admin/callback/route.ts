// app/admin/callback/route.ts
//
// Magic-link landing (UNGUARDED). The email link points here with a
// ?code=… (PKCE); we exchange it for a session (cookies set by the server
// client) and redirect into /admin, where the (protected) layout runs the
// authorization decision tree.
//
// On any failure we send the user to /admin/login?error=auth — never to
// the protected area without a session.
//
// ─────────────────────────────────────────────────────────────────────────
// PKCE FALLBACK (if exchangeCodeForSession fails during smoke):
// The default Supabase email template uses {{ .ConfirmationURL }} → a ?code=
// link that this handler exchanges. @supabase/ssr stores the PKCE code-
// verifier in a cookie shared with this server route; if that cookie isn't
// present for some client/flow, the exchange fails.
//
// Fallback = the token_hash + verifyOtp flow (no verifier needed):
//   1. Dashboard → Authentication → Email Templates → Magic Link: set the
//      link to
//        {{ .SiteURL }}/admin/callback?token_hash={{ .TokenHash }}&type=email
//   2. Here, read token_hash + type and call instead of the code exchange:
//        await supabase.auth.verifyOtp({ type, token_hash })
// Build the code-exchange path first; switch only if smoke fails. Also
// recorded in RUNBOOK.md "Admin auth bootstrap".
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/admin`);
    }
    console.error("[admin/callback] exchangeCodeForSession failed", error);
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
