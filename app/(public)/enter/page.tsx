"use client";

// app/(public)/enter/page.tsx
//
// D66 — Participant rescue-path entry for the 6-digit access code. The
// /enter route is the fallback when an email scanner (Microsoft 365
// Defender / Outlook URL-prefetch) consumes the /r/[token] URL before
// the recipient can click. Symmetric with the URL flow: on success,
// setSession + setLang + redirect("/") — same as /r/[token]/route.ts.
//
// SINGLE-STATE FORM — just the code input. NO email-second-factor
// (would change the brief's UX). NO password, NO captcha. Brute-force
// resistance is layered (see D66 DECISIONS): 1M entropy + 60-day TTL +
// audit forensics + max_uses budget gate + best-effort in-memory rate
// limit in the Server Action.
//
// NO-ENUMERATION: any malformed input or wrong code yields the SAME
// generic "Invalid or expired code" message. The caller cannot
// distinguish failure modes.
//
// BILINGUAL STACK matches /invitation-invalid: EN first (ltr), AR
// second (rtl + font-arabic). The input itself is locale-neutral
// (6 ASCII digits), so it sits below both language blocks.
//
// AUTOCOMPLETE / KEYBOARD: type="text" + inputMode="numeric" +
// autoComplete="one-time-code" — iOS Safari + most modern browsers
// surface the SMS/email OTP autofill prompt. Mirrors /admin/login D65's
// code input attributes.

import { useState } from "react";
import { validateAccessCodeAction } from "@/lib/actions/access-code";

export default function EnterPage() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<boolean>(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (pending || !/^\d{6}$/.test(code)) return;
    setPending(true);
    setError(false);
    const result = await validateAccessCodeAction(code);
    // Reaching this line means the action RETURNED (didn't redirect)
    // → failure. On the success path the framework already triggered
    // navigation before we got here.
    if (!result.ok) {
      setError(true);
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-white flex items-start justify-center pt-24 pb-24 px-6">
      <div className="max-w-md w-full">
        <div className="text-[12px] font-semibold text-muted text-center mb-12 tracking-tight">
          Yarmouk Study
        </div>

        {/* English block */}
        <div lang="en" dir="ltr" className="mb-8">
          <h1 className="text-[22px] font-semibold text-ink mb-3 tracking-tight">
            Enter your invitation code
          </h1>
          <p className="text-[15px] text-muted-strong leading-relaxed">
            Type the 6-digit code from your Yarmouk Study invitation email.
          </p>
        </div>

        {/* Arabic block */}
        <div lang="ar" dir="rtl" className="font-arabic mb-8">
          <h1 className="text-[22px] font-semibold text-ink mb-3 tracking-tight">
            أدخل رمز الدعوة
          </h1>
          <p className="text-[15px] text-muted-strong leading-relaxed">
            اكتب الرمز المكوّن من 6 أرقام الموجود في بريد دعوة دراسة اليرموك.
          </p>
        </div>

        <form onSubmit={onSubmit}>
          <input
            id="enter-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            pattern="[0-9]{6}"
            maxLength={6}
            required
            aria-label="6-digit invitation code"
            className="field tracking-widest text-center font-mono text-[20px]"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
          />
          {error && (
            <div className="mt-3 space-y-1">
              <p lang="en" dir="ltr" className="text-[13px] text-warn">
                Invalid or expired code. Try again, or contact the researcher.
              </p>
              <p
                lang="ar"
                dir="rtl"
                className="text-[13px] text-warn font-arabic"
              >
                الرمز غير صالح أو منتهي الصلاحية. حاول مرة أخرى، أو تواصل مع
                الباحثة.
              </p>
            </div>
          )}
          <button
            type="submit"
            disabled={pending || !/^\d{6}$/.test(code)}
            className="btn-primary w-full justify-center mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span lang="en" dir="ltr">
              {pending ? "Verifying…" : "Open my questionnaire"}
            </span>
            <span className="mx-2 text-white/50">·</span>
            <span lang="ar" dir="rtl" className="font-arabic">
              {pending ? "جارٍ التحقق…" : "افتح استبياني"}
            </span>
          </button>
        </form>

        <p className="text-[11px] text-muted-faint text-center mt-8">
          <span lang="en" dir="ltr">
            Access is by invitation only.
          </span>
          <span className="mx-2">·</span>
          <span lang="ar" dir="rtl" className="font-arabic">
            الدخول بالدعوة فقط.
          </span>
        </p>
      </div>
    </main>
  );
}
