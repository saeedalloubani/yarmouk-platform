// app/r/[token]/route.ts
//
// Public entry point for invitation links. /r/<plaintext-token>.
// Always returns a redirect; never returns content.
//
// Atomicity model (D42): one RPC does the entire claim — validate
// the token, increment use_count, transition status sent→opened, and
// either resume the existing in-flight response or INSERT a fresh
// one. The route handler is just plumbing: parse → RPC → cookies →
// redirect.
//
// Per D43: invitation.preferred_language is written to yarmouk_lang
// every time (including resumption). The email link is the canonical
// reset path; any mid-flow LanguageSwitcher choice gets overridden.
//
// Per D41: yarmouk_session is unsigned. setSession just writes the
// response_id; getSession() at every read re-validates against the
// DB.
//
// Per principle of least privilege: anon Supabase client. The RPC
// is GRANTed to anon and is SECURITY DEFINER for its own writes —
// no need to escalate at the call site.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setLang, setSession } from "@/lib/cookies";
import type { Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("validate_invitation_token", {
    p_token: token,
  });

  // RPC errored — log for ops, redirect to terminal-failure page.
  if (error) {
    console.error("[r/token] validate_invitation_token failed", error);
    return NextResponse.redirect(new URL("/invitation-invalid", request.url));
  }

  // Token invalid / expired / exhausted / already-submitted — same
  // terminal page, silent (no log spam from bot scans + bad URLs).
  if (!data || data.length === 0) {
    return NextResponse.redirect(new URL("/invitation-invalid", request.url));
  }

  const row = data[0];

  // setSession first (semantically primary), setLang second. Both
  // are queued as Set-Cookie headers and flushed at the redirect.
  await setSession({
    responseId: row.response_id,
    expiresAt: new Date(row.expires_at),
  });
  await setLang(row.language as Lang);
  // ^ Safe cast: DB CHECK on invitations.preferred_language enforces
  //   'en' | 'ar'; the RPC sources this column verbatim. Generated
  //   type is `string` because CHECK isn't reflected. Same caveat as
  //   the cast in lib/cookies.ts getSession().

  return NextResponse.redirect(new URL("/", request.url));
}
