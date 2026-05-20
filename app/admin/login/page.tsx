"use client";

// app/admin/login/page.tsx
//
// Admin login (UNGUARDED — sits outside app/admin/(protected)). Passwordless
// magic-link / OTP via Supabase's built-in email (D50). signInWithOtp uses
// shouldCreateUser:false so the form can never mint an auth identity (D49) —
// only emails pre-provisioned in the dashboard receive a link.
//
// The result is intentionally NOT differentiated: we show the same
// "check your email" state whether or not the email is an authorized admin,
// to avoid admin-email enumeration (D50).

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || email.trim().length === 0) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    // Fire-and-forget by design: don't branch on the result (no
    // enumeration). Errors (e.g. signups-disabled for an unknown email)
    // resolve to the same neutral confirmation.
    await supabase.auth
      .signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/admin/callback`,
        },
      })
      .catch((err) => {
        console.error("[admin/login] signInWithOtp error", err);
      });
    setSent(true);
    setPending(false);
  }

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <div className="text-[13px] font-bold text-ink tracking-tight text-center mb-1">
          Yarmouk Study
        </div>
        <div className="eyebrow text-center mb-8">Researcher Access</div>

        {sent ? (
          <div className="card p-6 text-center">
            <h1 className="text-[18px] font-semibold text-ink mb-2">
              Check your email
            </h1>
            <p className="text-[14px] text-muted-strong leading-relaxed">
              If your email is authorized, a sign-in link is on its way. It
              expires shortly — open it on this device.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card p-6">
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
              {pending ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}

        <p className="text-[11px] text-muted-faint text-center mt-6">
          Access is by pre-authorization only.
        </p>
      </div>
    </main>
  );
}
