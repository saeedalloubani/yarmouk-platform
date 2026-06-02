"use client";

// app/admin/login/page.tsx
//
// Admin login (UNGUARDED — sits outside app/admin/(protected)). Two-state
// OTP code flow as of D65: enter_email → submit → enter_code → submit → /admin.
//
// D65 SWITCH — Replaced the clickable magic-link with a 6-digit OTP code
// rendered as TEXT in the email body, defeating Microsoft 365 Defender's
// URL prefetch (which was consuming single-use tokens before Sura could
// click; audit log showed 8+ verify_failed events per single login
// attempt). See DECISIONS.md D65 for the audit evidence + the
// alternatives considered.
//
// The signInWithOtp SDK call (state 1 submit) is unchanged — same
// browser client, same shouldCreateUser:false (D49), same no-enumeration
// discipline (D50: transition to enter_code regardless of result, never
// branch on whether the email is in the admins allowlist). Only the
// SUPABASE EMAIL TEMPLATE in Studio is changed (URL → {{ .Token }} text
// rendering). The same SDK emit covers both flows.
//
// verifyOtp (state 2 submit) goes through a SERVER ACTION
// (lib/actions/admin-auth.ts verifyOtpAction) so session cookies are
// written by @supabase/ssr's server client via next/headers — same
// proven path as /admin/callback's success branch. Browser-side
// verifyOtp would write via document.cookie, which we haven't validated
// against the Vercel-edge environment where the PKCE cookie historically
// failed.
//
// The legacy /admin/callback route stays alive for backward compat:
// any in-flight email sent BEFORE the Supabase template change still
// has a clickable URL pointing there, and that URL still resolves.

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { verifyOtpAction } from "@/lib/actions/admin-auth";

type Stage = "enter_email" | "enter_code";

export default function AdminLoginPage() {
  const [stage, setStage] = useState<Stage>("enter_email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBlip, setResendBlip] = useState(false);

  // ─── State 1: request the code via signInWithOtp ────────────────
  // Fire-and-forget by design — D50 no-enumeration. Errors (signups
  // disabled for unknown email, rate-limited, malformed input, etc.)
  // resolve to the SAME enter_code UI as a successful send. The
  // recipient either has the code in their inbox or they don't; if
  // they don't, verifyOtp will fail in state 2 and they stay there
  // with the same generic error message.
  //
  // NO emailRedirectTo — there's no clickable target. The email
  // template renders {{ .Token }} as text only. (The legacy
  // /admin/callback route still handles any in-flight clickable URLs
  // from emails sent before the Supabase template change.)
  async function requestCode(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth
      .signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
        },
      })
      .catch((err) => {
        // Never surface to user, never branch on result — D50.
        console.error("[admin/login] signInWithOtp error", err);
      });
  }

  async function onSubmitEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (pending || email.trim().length === 0) return;
    setPending(true);
    setError(null);
    await requestCode();
    setStage("enter_code");
    setPending(false);
  }

  // ─── State 2: verify the code via Server Action ─────────────────
  // Server Action `verifyOtpAction` calls verifyOtp server-side. On
  // success it calls redirect("/admin") which Next.js's Server Action
  // handler intercepts and triggers a browser navigation — the await
  // below never resolves to a value on the success path. On failure
  // the action returns { ok: false } and we surface a generic inline
  // error (no enumeration of WHY it failed).
  async function onSubmitCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (pending || !/^\d{6}$/.test(code)) return;
    setPending(true);
    setError(null);
    const result = await verifyOtpAction(email.trim(), code);
    // Reaching this line means the action RETURNED (didn't redirect)
    // → failure. On the success path the framework has already
    // triggered navigation before we get here.
    if (!result.ok) {
      setError("Invalid or expired code. Try again or request a new one.");
      setPending(false);
    }
  }

  async function onResend(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    await requestCode();
    setPending(false);
    setResendBlip(true);
    setTimeout(() => setResendBlip(false), 3000);
  }

  function onResetEmail(): void {
    setStage("enter_email");
    setCode("");
    setError(null);
  }

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <div className="text-[13px] font-bold text-ink tracking-tight text-center mb-1">
          Yarmouk Study
        </div>
        <div className="eyebrow text-center mb-8">Researcher Access</div>

        {stage === "enter_email" ? (
          <form onSubmit={onSubmitEmail} className="card p-6">
            <label className="label" htmlFor="admin-email">
              Email address
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              required
              className="field mb-4"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.edu"
            />
            <button
              type="submit"
              disabled={pending || email.trim().length === 0}
              className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? "Sending…" : "Send sign-in code"}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitCode} className="card p-6">
            <h1 className="text-[18px] font-semibold text-ink mb-2">
              Check your email
            </h1>
            <p className="text-[13px] text-muted-strong leading-relaxed mb-4">
              We sent a 6-digit code to{" "}
              <strong className="text-ink">{email}</strong>. Enter it below.
            </p>
            <label className="label" htmlFor="admin-otp-code">
              Code
            </label>
            <input
              id="admin-otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className="field mb-1 tracking-widest text-center font-mono"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
            />
            {error && (
              <p className="text-[12px] text-warn mt-1 mb-1">{error}</p>
            )}
            <button
              type="submit"
              disabled={pending || !/^\d{6}$/.test(code)}
              className="btn-primary w-full justify-center mt-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? "Verifying…" : "Verify code"}
            </button>
            <div className="mt-4 flex items-center justify-between text-[12px]">
              <button
                type="button"
                onClick={onResend}
                disabled={pending}
                className="text-brand-700 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resendBlip ? "Sent" : "Didn't receive a code? Resend"}
              </button>
              <button
                type="button"
                onClick={onResetEmail}
                disabled={pending}
                className="text-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        <p className="text-[11px] text-muted-faint text-center mt-6">
          Access is by pre-authorization only.
        </p>
      </div>
    </main>
  );
}
