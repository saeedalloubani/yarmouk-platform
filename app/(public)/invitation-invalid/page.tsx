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
//   - No internal links — no "go home", no retry. Re-entering the
//     email link would just route back through /r/[token] and end
//     up here again. Terminal page = full stop.
//   - Bilingual stack: English first (alphabetical-by-language-
//     code), Arabic second.
//
// Three Arabic strings (invalidTitle, invalidBody, invalidContact-
// Label) are deferred for pre-launch translation per the row in
// docs/STATUS.md "Known Open Items". The Arabic block currently
// renders a visible amber-dashed placeholder so the gap is obvious
// to anyone testing the page.
//
// Contact email hardcoded from supabase/migrations/
// 20260519170007_settings_seed.sql (reply_to). The mailto: link
// pre-fills a subject line so Sura immediately recognizes the
// workflow when she receives the message. External href, no
// internal navigation loop possible.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invalid invitation — Yarmouk Study",
};

const CONTACT_EMAIL = "sjkarasneh24@eng.just.edu.jo";
const CONTACT_HREF =
  `mailto:${CONTACT_EMAIL}?subject=Invalid%20Yarmouk%20invitation`;

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
          </p>
        </div>

        {/* Arabic block — visible placeholder pending pre-launch translation.
            Amber-dashed border + warnLight bg + italic warn text makes the
            gap unmistakable during QA. Replace with real Arabic strings from
            i18n.ts when Sura supplies them. */}
        <div
          lang="ar"
          dir="rtl"
          className="font-arabic border border-dashed border-warn bg-warnLight rounded-md p-4 italic text-warn text-[13px] text-center"
        >
          [Arabic text — to be added before launch]
        </div>
      </div>
    </main>
  );
}
