// lib/cookies.ts
//
// Server-side cookie helpers for the respondent flow.
//
// Read helpers (getLang, getSession) are safe to call from any
// server context: Server Components, Route Handlers, Server Actions.
// Write helpers (setLang, setSession, clearSession) MUST be called
// from a Route Handler or Server Action — Next.js disallows cookie
// writes during RSC render and will throw at runtime if you try.
//
// The session cookie is intentionally unsigned (D41). Integrity comes
// from re-validating against the DB on every read of getSession() —
// see the comment block on that function for the threat model.
//
// Why the admin (service-role) client for the hydration query:
// `responses` RLS only permits owner-role SELECT. The respondent is
// anonymous to Postgres — they have no JWT. The route handler and the
// public Server Components need to read THEIR session row without
// authenticating. The admin client (server-only, throws on browser
// import per lib/supabase/admin.ts) bypasses RLS for this narrow
// lookup, scoped to a single response_id. Threat model is identical
// to a permissive RLS policy that lets anon select any response —
// integrity hinges on UUIDv4 unguessability either way. The admin
// client is preferred because the privilege escalation is explicit
// at the call site and the RLS surface stays minimal.
//
// (Future: if column-level lockdown is wanted, replace the admin-
// client lookups with a SECURITY DEFINER RPC `get_session(p_id UUID)`
// returning a fixed shape. Not needed at thesis scale.)

import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "./supabase/admin";
import type {
  InvitationCategory,
  InvitationNationality,
} from "./repos/invitations";
import type { Lang } from "./i18n";

// Re-export so existing consumers can continue importing `type Lang`
// from "@/lib/cookies". Canonical home is "./i18n" (server- and
// client-safe; cookies.ts can't be the canonical home because of
// next/headers).
export type { Lang };

export type Session = {
  responseId: string;
  invitationId: string;
  refCode: string;
  category: InvitationCategory;
  nationality: InvitationNationality | null;
  /**
   * The language the invitation was issued for. Stable for the
   * respondent's session. NOT the user's current selection — call
   * getLang() for that.
   */
  language: Lang;
  /** ISO timestamp from invitations.expires_at. */
  expiresAt: string;
  questionnaireVersionId: string;
};

const LANG_COOKIE = "yarmouk_lang";
const SESSION_COOKIE = "yarmouk_session";

const ONE_YEAR_SECS = 60 * 60 * 24 * 365;
const IS_PROD = process.env.NODE_ENV === "production";

// Relaxed UUID format — matches any 8-4-4-4-12 hex pattern (UUIDv1
// through v8). We don't need to enforce v4 specifically; the DB
// generates v4 via gen_random_uuid(), and rejecting non-hex is the
// only thing that matters here (prevents .eq('id', '<garbage>') from
// hitting Postgres with an invalid-uuid error).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Lang cookie (yarmouk_lang) ----

/** Read the lang cookie. Returns 'en' when absent or invalid. */
export async function getLang(): Promise<Lang> {
  const c = await cookies();
  const v = c.get(LANG_COOKIE)?.value;
  return v === "ar" || v === "en" ? v : "en";
}

/**
 * Write the lang cookie. 1-year max-age, lax, NOT httpOnly so the
 * LanguageSwitcher client component can read it for active-button
 * highlighting.
 *
 * MUST be called from a Route Handler or Server Action.
 */
export async function setLang(lang: Lang): Promise<void> {
  const c = await cookies();
  c.set(LANG_COOKIE, lang, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECS,
  });
}

// ---- Session cookie (yarmouk_session) ----

/**
 * Read the session cookie, hydrate from DB, return a Session if the
 * row exists, is unlocked, unsubmitted, and the invitation has not
 * expired. Returns null otherwise.
 *
 * LIMITATION: this function uses the admin client, which bypasses
 * RLS. It MUST NOT be extended to perform writes — keep it pure
 * read. If you need a mutative session helper (e.g., touching
 * last_seen_at), create a separate SECURITY DEFINER RPC with a
 * narrow contract and call it from the anon client instead.
 *
 * Hits the DB on every call (per D41 — no in-memory cache, no signed-
 * cookie shortcut). If a single request needs the session multiple
 * times, wrap the caller in React.cache() for per-request memoization.
 *
 * Returns null (rather than throwing) on DB errors so a transient
 * Supabase blip surfaces as "no session" rather than a crashed page.
 * The error is logged for operational visibility.
 */
export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const raw = c.get(SESSION_COOKIE)?.value;
  if (!raw || !UUID_RE.test(raw)) return null;

  const admin = createSupabaseAdminClient();

  // Step 1: the response row. Filters out locked + already-submitted.
  const { data: resp, error: respErr } = await admin
    .from("responses")
    .select("id, invitation_id, is_locked, submitted_at")
    .eq("id", raw)
    .maybeSingle();

  if (respErr) {
    console.error("[cookies] getSession responses lookup failed", respErr);
    return null;
  }
  if (!resp) return null;
  if (resp.is_locked || resp.submitted_at) return null;

  // Step 2: the bound invitation. Filters out expired.
  const { data: inv, error: invErr } = await admin
    .from("invitations")
    .select(
      "id, ref_code, category, nationality, preferred_language, questionnaire_version_id, expires_at"
    )
    .eq("id", resp.invitation_id)
    .maybeSingle();

  if (invErr) {
    console.error("[cookies] getSession invitations lookup failed", invErr);
    return null;
  }
  if (!inv) return null;
  if (new Date(inv.expires_at) <= new Date()) return null;

  return {
    responseId: resp.id,
    invitationId: inv.id,
    refCode: inv.ref_code,
    category: inv.category,
    nationality: inv.nationality,
    language: inv.preferred_language as Lang,
    // ^ Safe cast: invitations.preferred_language is TEXT with a
    //   CHECK constraint enforcing 'en' | 'ar' at the DB level.
    //   Generated types show `string` because CHECK isn't reflected.
    //   If the CHECK is ever loosened, narrow this cast or this
    //   line lies.
    expiresAt: inv.expires_at,
    questionnaireVersionId: inv.questionnaire_version_id,
  };
}

/**
 * Write the session cookie. Absolute expiry = invitation.expires_at.
 * httpOnly, Secure in production, SameSite=Lax (must survive the
 * email-link top-level navigation — Strict would drop the cookie on
 * that first hop).
 *
 * MUST be called from a Route Handler or Server Action.
 */
export async function setSession(input: {
  responseId: string;
  expiresAt: Date;
}): Promise<void> {
  const c = await cookies();
  c.set(SESSION_COOKIE, input.responseId, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    expires: input.expiresAt,
  });
}

/**
 * Clear both cookies (session + lang). Full reset — e.g. an admin
 * "exit session" UI we add later.
 *
 * MUST be called from a Route Handler or Server Action.
 */
export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.delete({ name: SESSION_COOKIE, path: "/" });
  c.delete({ name: LANG_COOKIE, path: "/" });
}

/**
 * Clear ONLY the session cookie, preserving the lang cookie. Used at
 * submission: the response becomes terminal (getSession() already
 * returns null once submitted_at is set), and we drop the session
 * cookie for hygiene — but keep the lang cookie so the /submitted
 * thank-you page still renders in the respondent's language.
 *
 * MUST be called from a Route Handler or Server Action (cookie writes
 * are forbidden during RSC render — this can't run inside the page).
 */
export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete({ name: SESSION_COOKIE, path: "/" });
}
