// app/admin/(protected)/invitations/[id]/send-reminder/route.ts
//
// D79 Feature 3 — manual-reminder POST endpoint. The SendReminderButton's
// <form> posts here; we owner-gate, rate-limit, dispatch via
// sendManualReminder, then 303-redirect to the page the form was
// submitted from (the Referer) with flash params so a banner can
// surface success / failure.
//
// OWNER-ONLY — gate mirrors /admin/exports/download verbatim. 401 if no
// admin, 403 if non-owner. The page-level (protected) layout already
// guards, but this defends against direct POST (and against any
// hypothetical future linkage from a non-owner surface).
//
// AUDIT WRITE ORDER — single entry per attempt. Success row is written
// inside sendManualReminder; failure row also inside (so a rate-limit
// reject is the ONLY failure path that doesn't audit — by design, a
// rate-limit gate is not a delivery failure, just a UX cooldown). No
// "started" row.
//
// REDIRECT — 303 See Other so the browser follows with GET, not POST.
// The flash params are: reminder=sent|failed, ref=<refCode>, optional
// reason=<errorClass>. The page-level read of these params is in
// /admin/invitations/page.tsx + /admin/(protected)/page.tsx (the two
// surfaces where SendReminderButton renders). Cache-Control: no-store
// on every response.

import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getLastManualReminderAt,
} from "@/lib/repos/pilot";
import { sendManualReminder } from "@/lib/email/reminder-manual";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-invitation cooldown between manual reminders. Sura should not
// accidentally double-send within minutes. 10 minutes is generous
// enough to absorb a refresh / back-button retry, tight enough to let
// her self-correct in the same session if her first attempt failed and
// she fixed something (e.g. Vault key issue).
const COOLDOWN_MINUTES = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default landing page if the Referer is absent (direct POST). */
const FALLBACK_RETURN = "/admin/invitations";

function redirectWithFlash(
  baseUrl: string,
  params: Record<string, string>
): NextResponse {
  // baseUrl may already have a querystring (e.g. /admin/security?severity=warn);
  // we append our own params, overwriting collisions. URL handles both.
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url, {
    status: 303,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/** Same-origin Referer guard. Falls back to FALLBACK_RETURN if the
 *  referer header is absent OR if it's cross-origin (defense against an
 *  external POST that would redirect off our origin). The fallback is a
 *  path; we resolve it against the request URL's origin. */
function resolveReturnUrl(request: NextRequest): URL {
  const referer = request.headers.get("referer");
  const requestUrl = new URL(request.url);
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === requestUrl.origin) {
        return refererUrl;
      }
    } catch {
      // Malformed referer header; fall through.
    }
  }
  return new URL(FALLBACK_RETURN, requestUrl.origin);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const returnUrl = resolveReturnUrl(request);

  // ── 1. Owner gate ─────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) {
    return new NextResponse(null, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
  if (admin.role !== "owner") {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // ── 2. Validate the path param ───────────────────────────────────
  if (!UUID_RE.test(id)) {
    return redirectWithFlash(returnUrl.href, {
      reminder: "failed",
      ref: "?",
      reason: "invalid_id",
    });
  }

  // ── 3. Look up refCode first (cheap), use it for rate-limit query ─
  // sendManualReminder will re-fetch the row but we need the refCode
  // here to query audit_log for the cooldown check. One extra round-trip
  // for clarity; the row is hot in the buffer pool after.
  const { data: invMeta, error: metaErr } = await supabase
    .from("invitations")
    .select("ref_code")
    .eq("id", id)
    .maybeSingle();
  if (metaErr) {
    return redirectWithFlash(returnUrl.href, {
      reminder: "failed",
      ref: "?",
      reason: "config",
    });
  }
  if (!invMeta) {
    return redirectWithFlash(returnUrl.href, {
      reminder: "failed",
      ref: "?",
      reason: "not_found",
    });
  }
  const refCode = invMeta.ref_code;

  // ── 4. Rate-limit check (audit_log is source of truth, FLAG D) ───
  // If the most recent manual-reminder success for this refCode is
  // newer than (now - COOLDOWN_MINUTES), reject. Surface the remaining
  // wait in the flash so Sura sees a useful message.
  let lastAt: string | null = null;
  try {
    lastAt = await getLastManualReminderAt(supabase, refCode);
  } catch {
    // RLS/connection hiccup — fail closed (treat as "no cooldown"
    // rather than block Sura from sending). Same trade-off as
    // logAudit's "throw on RPC error" inverted: a missed gate is less
    // bad than a stuck button.
    lastAt = null;
  }
  if (lastAt) {
    const ageMs = Date.now() - new Date(lastAt).getTime();
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
    if (ageMs < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - ageMs) / 60000);
      return redirectWithFlash(returnUrl.href, {
        reminder: "failed",
        ref: refCode,
        reason: "rate_limited",
        wait: String(waitMin),
      });
    }
  }

  // ── 5. Dispatch (decrypt → render → send → audit) ────────────────
  const result = await sendManualReminder(supabase, id);

  if (result.ok) {
    return redirectWithFlash(returnUrl.href, {
      reminder: "sent",
      ref: result.refCode,
    });
  }
  return redirectWithFlash(returnUrl.href, {
    reminder: "failed",
    ref: result.refCode,
    reason: result.errorClass,
  });
}
