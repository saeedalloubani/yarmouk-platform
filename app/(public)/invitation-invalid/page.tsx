// app/(public)/invitation-invalid/page.tsx
//
// Terminal landing for failed token entry. Reached when:
//   - The invitation link's token doesn't resolve (bad/expired/
//     exhausted/already-submitted) — see app/r/[token]/route.ts
//   - A direct visit to /invitation-invalid (curious browsing or
//     someone testing)
//
// Constraints enforced here:
//   - No DB calls (we don't know the user's language since their
//     token failed, so we can't resolve a Lang from invitation
//     state)
//   - No getLang / getSession (same reason: nothing to read)
//   - ONE internal link: the D66 access-code rescue path to /enter.
//     This is NOT a loop — a successful code entry leaves this page
//     entirely (sets session, redirects to /). A failed code attempt
//     stays at /enter (its own failure surface), never bounces back
//     here. Without /enter, a Microsoft 365 Defender URL-prefetch
//     consuming the invitation token would leave the recipient with
//     no recovery path at all (see D66 DECISIONS).
//   - Bilingual stack: English first (alphabetical-by-language-
//     code), Arabic second.
//
// The Arabic block (title + body + contact-intro) now carries real
// Arabic (2026-05-23 pass); the amber-dashed QA placeholder is gone.
// Both blocks are hardcoded here rather than keyed in lib/i18n.ts
// because this page resolves no Lang (the token failed) — it always
// shows both languages stacked. The contact line (name/email) appears
// once, in the English block above.
//
// Contact email hardcoded from supabase/migrations/
// 20260519170007_settings_seed.sql (reply_to). The mailto: link
// pre-fills a subject line so Sura immediately recognizes the
// workflow when she receives the message. External href, no
// internal navigation loop possible.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Invalid invitation — Yarmouk Study",
};

const CONTACT_EMAIL = "sjkarasneh24@eng.just.edu.jo";
const CONTACT_HREF =
  `mailto:${CONTACT_EMAIL}?subject=Invalid%20Yarmouk%20invitation`;
const CONTACT_PHONE = "+962 7 9661 0400";
const CONTACT_PHONE_HREF = "tel:+962796610400";

export default function InvitationInvalidPage() {
  return (
    <main className="min-h-screen bg-white flex items-start justify-center pt-24 pb-24 px-6">
      <div className="max-w-md w-full">
        <div className="text-[12px] font-semibold text-muted text-center mb-12 tracking-tight">
          Yarmouk Study
        </div>

        {/* English block */}
        <div lang="en" dir="ltr" className="mb-10">
          <h1 className="text-[22px] font-semibold text-ink mb-3 tracking-tight">
            Invitation link not valid
          </h1>
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            This invitation link is no longer valid.
          </p>
          {/* D66 — soft fallback to the 6-digit code path. */}
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            If your email scanner consumed the link before you could click, you
            can enter the 6-digit code from your invitation email instead.
          </p>
          <p className="mb-6">
            <Link
              href="/enter"
              className="btn-primary inline-flex px-6 py-2 text-[14px]"
            >
              Enter your code
            </Link>
          </p>
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            If you believe this is an error, please contact the researcher:
          </p>
          <p className="text-[14px] text-muted">
            Sura Karasneh —{" "}
            <a
              href={CONTACT_HREF}
              className="mono text-ink underline underline-offset-2 hover:text-brand-700"
            >
              {CONTACT_EMAIL}
            </a>
            {" — "}
            <a
              href={CONTACT_PHONE_HREF}
              className="mono text-ink underline underline-offset-2 hover:text-brand-700"
            >
              {CONTACT_PHONE}
            </a>
          </p>
        </div>

        {/* Arabic block — mirrors the EN structure incl. its own contact line
            (Arabic name + shared email/phone). The email + phone are LTR runs
            inside this RTL block, so each <a> carries dir="ltr" to isolate
            them (Latin address, +962 digits, "—" separators stay in order). */}
        <div lang="ar" dir="rtl" className="font-arabic">
          <h1 className="text-[22px] font-semibold text-ink mb-3 tracking-tight">
            رابط الدعوة غير صالح
          </h1>
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            لم يعد رابط الدعوة هذا صالحاً.
          </p>
          {/* D66 — soft fallback to the 6-digit code path. */}
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            إذا قام برنامج فحص البريد بفتح الرابط قبلك، يمكنك بدلاً من ذلك إدخال
            الرمز المكوّن من 6 أرقام الموجود في بريد الدعوة.
          </p>
          <p className="mb-6">
            <Link
              href="/enter"
              className="btn-primary inline-flex px-6 py-2 text-[14px]"
            >
              أدخل الرمز
            </Link>
          </p>
          <p className="text-[15px] text-muted-strong leading-relaxed mb-3">
            إذا كنت تعتقد أن هذا خطأ، يُرجى التواصل مع الباحثة:
          </p>
          <p className="text-[14px] text-muted">
            سرى كراسنة —{" "}
            <a
              href={CONTACT_HREF}
              dir="ltr"
              className="mono text-ink underline underline-offset-2 hover:text-brand-700"
            >
              {CONTACT_EMAIL}
            </a>
            {" — "}
            <a
              href={CONTACT_PHONE_HREF}
              dir="ltr"
              className="mono text-ink underline underline-offset-2 hover:text-brand-700"
            >
              {CONTACT_PHONE}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
