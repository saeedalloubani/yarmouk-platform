"use server";

// lib/actions/setLang.ts
//
// Thin Server Action wrapper over lib/cookies.ts setLang. Exists so
// client components can write the yarmouk_lang cookie without
// duplicating setLang's attribute logic (httpOnly: false, secure
// in prod, sameSite=lax, maxAge=1y). Single source of truth stays
// in lib/cookies.ts.
//
// Per Next.js 15 Server Action conventions: this is a public-facing
// endpoint at runtime — anyone can POST to it with arbitrary input.
// The runtime input validation here is defence against a forged
// request, not a substitute for the typed client boundary. Next.js
// also enforces an Origin-header check on Server Actions to prevent
// cross-site invocation, so a third party can't POST to this from
// another site.
//
// The thrown error deliberately does NOT echo the user-supplied
// value into its message. Vercel's request log captures the Server
// Action arguments with proper structure where forensic detail
// belongs; echoing untrusted input into log lines via Error messages
// creates a small log-injection vector (`lang = "en\nFAKE: admin ..."`
// could inject what looks like a real audit event).

import { setLang, type Lang } from "@/lib/cookies";

export async function setLangAction(lang: Lang): Promise<void> {
  if (lang !== "en" && lang !== "ar") {
    // The typed client boundary makes this theoretically unreachable,
    // but Server Actions accept any serializable payload at the HTTP
    // layer. Reject anything that isn't a recognized Lang.
    throw new Error("Invalid lang value");
  }
  await setLang(lang);
}
