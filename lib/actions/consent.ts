"use server";

// lib/actions/consent.ts
//
// submitConsent Server Action. Validates the consent inputs SERVER-SIDE
// (never trusts the client gate), encrypts the signed name in the DB
// via encrypt_pii (key in Vault, app never sees it — D36), writes the
// consent_records row through the public-flow repo helpers (D48), and
// redirects to /questionnaire.
//
// response_id is derived from the session cookie — never passed by the
// client. Re-entry to /consent after consenting redirects forward
// (response_id is UNIQUE; you can't re-consent).

import { redirect } from "next/navigation";
import { getSession, getLang } from "@/lib/cookies";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  consentExistsForResponse,
  insertConsentRecord,
} from "@/lib/repos/consent";

export type ConsentInput = {
  agreedToRead: boolean;
  agreedToParticipate: boolean;
  audioChoice: "audio" | "noaudio" | null;
  name: string;
};

// Success redirects to /questionnaire (throws NEXT_REDIRECT); only
// failures return a value.
export type ConsentResult = { ok: false; error: "validation" | "server" };

export async function submitConsent(
  input: ConsentInput
): Promise<ConsentResult> {
  const session = await getSession();
  if (!session) redirect("/"); // no session → landing; narrows below

  const admin = createSupabaseAdminClient();

  // Re-entry guard: consent already exists (response_id UNIQUE) → forward.
  if (await consentExistsForResponse(admin, session.responseId)) {
    redirect("/questionnaire");
  }

  // Server-side validation — never trust the client gate (D47-style).
  const name = input.name.trim();
  if (
    input.agreedToRead !== true ||
    input.agreedToParticipate !== true ||
    (input.audioChoice !== "audio" && input.audioChoice !== "noaudio") ||
    name.length === 0
  ) {
    return { ok: false, error: "validation" };
  }

  // Encrypt the name in the DB — key lives in Vault, app never sees it (D36).
  const { data: encryptedName, error: encErr } = await admin.rpc(
    "encrypt_pii",
    { p_plaintext: name }
  );
  if (encErr || !encryptedName) {
    console.error("[consent] encrypt_pii failed", encErr);
    return { ok: false, error: "server" };
  }

  const lang = await getLang();

  const { error: insErr } = await insertConsentRecord(admin, {
    responseId: session.responseId,
    signedNameEncrypted: encryptedName,
    audioConsent: input.audioChoice === "audio",
    agreedToRead: true,
    agreedToParticipate: true,
    language: lang,
    consentTextVersion: "v1.0", // bump when consent wording changes (ethics trail)
  });

  if (insErr) {
    // 23505 = unique_violation: a concurrent submit already wrote consent.
    // Idempotent → treat as success and move forward.
    if (insErr.code === "23505") redirect("/questionnaire");
    console.error("[consent] insert failed", insErr);
    return { ok: false, error: "server" };
  }

  redirect("/questionnaire");
}
