"use server";

// lib/actions/access-code.ts
//
// D66 — Participant /enter rescue-path Server Action. Validates a
// 6-digit access code by calling validate_invitation_code, mirroring
// /r/[token]'s success path: setSession + setLang + redirect("/").
//
// WHY A SERVER ACTION (not Route Handler):
//
// Server Actions can write cookies via next/headers AND call
// redirect() which throws NEXT_REDIRECT — Next.js's Server Action
// handler intercepts the throw and triggers a client-side navigation.
// Mirrors D65's verifyOtpAction pattern exactly. /r/[token] is a Route
// Handler because it has no form; /enter has a form, so the Server
// Action shape fits.
//
// PII DISCIPLINE (D63 / D64 / D65 / D66 carries forward):
//
//   - p_code is consumed by the RPC and discarded. Never logged,
//     never in audit metadata.
//   - On failure (RPC empty or RPC error or rate-limit hit):
//     logFailedAccessCode("invalid_or_expired" | "rate_limited") writes
//     a warn audit row with reason bucket only. NO p_code in metadata,
//     NO IP, NO UA (the audit helper captures IP/UA from next/headers
//     for forensics but does not include them in the JSON metadata).
//     The reason union is narrow (lib/audit.ts).
//   - On RPC error (DB blip, not invalid code): logs to console only
//     (no audit), returns the same generic failure to the client (no
//     enumeration of "the database is down" vs "your code is wrong").
//
// RATE LIMITING (best-effort friction, NOT security):
//
//   In-memory map per process. Max 5 attempts per IP per 60 seconds.
//   Won't survive Vercel cold starts; each function instance has its
//   own memory. This is documented as "friction not security" in D66
//   DECISIONS — real security comes from:
//     (a) 1M entropy of 6-digit codes
//     (b) 60-day expires_at TTL
//     (c) Audit-log durability for brute-force forensics
//     (d) max_uses budget gate (use_count >= max_uses returns empty)
//   Future hardening: Vercel KV / Upstash if attack pattern emerges.
//
// NO-ENUMERATION:
//
//   Malformed input (non-6-digit, missing, wrong type) returns the
//   SAME generic error as a real RPC empty-return. The caller cannot
//   distinguish "you typed garbage" from "the code was wrong" from
//   "the code expired" from "you've been rate-limited."

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setLang, setSession } from "@/lib/cookies";
import { logFailedAccessCode } from "@/lib/audit";
import type { Lang } from "@/lib/i18n";

/** Result shape for validateAccessCodeAction. The `ok: true` branch is
 *  unreachable from a client component — the action redirects before
 *  returning. The branch exists only to satisfy TS exhaustiveness if a
 *  future caller awaits the action without a redirect. */
export type ValidateCodeResult =
  | { ok: true }
  | { ok: false; error: "invalid_or_expired" };

// In-memory rate limit. Cleared on cold start. Best-effort friction.
const ATTEMPTS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function checkAndRecordAttempt(ip: string): boolean {
  const now = Date.now();
  const recent = (ATTEMPTS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  ATTEMPTS.set(ip, recent);
  return true;
}

/**
 * Validate a 6-digit access code submitted at /enter. Returns
 * { ok: false, error } on failure (UI shows generic "Invalid or expired
 * code…" message). On success, calls redirect("/") which throws
 * NEXT_REDIRECT — the client-side action handler triggers a navigation
 * to the (public) landing page, which then routes to consent / in-
 * progress / submitted as appropriate via getSession().
 *
 * No p_code ever reaches the audit log or any console output beyond
 * the bucket name.
 */
export async function validateAccessCodeAction(
  code: string
): Promise<ValidateCodeResult> {
  // Defensive server-side shape check (the client UI also validates).
  // A malformed code returns the SAME generic error as a real RPC
  // failure — preserves no-enumeration.
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_or_expired" };
  }

  // Best-effort rate limit. Per-instance memory only.
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";
  if (!checkAndRecordAttempt(ip)) {
    await logFailedAccessCode("rate_limited");
    return { ok: false, error: "invalid_or_expired" };
  }

  // Anon Supabase client — RPC is GRANTed to anon, SECURITY DEFINER
  // does its own writes. Mirrors /r/[token]'s call site.
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("validate_invitation_code", {
    p_code: code,
  });

  if (error) {
    // RPC errored — DB blip, not "wrong code." Log for ops (NO code in
    // the log), surface generic failure. Don't audit DB errors as user
    // failures (audit means "someone tried a code"; this means "the
    // DB had a hiccup").
    console.error("[access-code] validate_invitation_code RPC failed");
    return { ok: false, error: "invalid_or_expired" };
  }

  if (!data || data.length === 0) {
    // Wrong / expired code, or pre-D66 row (NULL access_code_encrypted).
    // Audit + surface generic.
    await logFailedAccessCode("invalid_or_expired");
    return { ok: false, error: "invalid_or_expired" };
  }

  // Success — byte-equivalent to /r/[token]'s success branch.
  const row = data[0];
  await setSession({
    responseId: row.response_id,
    expiresAt: new Date(row.expires_at),
  });
  await setLang(row.language as Lang);
  // ^ Safe cast: DB CHECK on invitations.preferred_language enforces
  //   'en' | 'ar'. Same caveat as app/r/[token]/route.ts.

  // Throws NEXT_REDIRECT — Next.js's Server Action handler catches it
  // and triggers a browser navigation to /. The (public) landing page
  // reads getSession() and routes to consent/questionnaire/submitted
  // as appropriate.
  redirect("/");
}
