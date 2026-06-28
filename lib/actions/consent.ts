"use server";

// lib/actions/consent.ts
//
// submitConsent Server Action — D83 atomic-commit version.
//
// Validates the consent inputs SERVER-SIDE (never trusts the client
// gate), encrypts the signed name in the DB via encrypt_pii (key in
// Vault, app never sees it — D36), then calls the new D83
// commit_consent_sign SECURITY DEFINER RPC, which atomically:
//   1. INSERT consent_records ON CONFLICT (response_id) DO NOTHING
//      RETURNING id  — idempotent against double-submit / network
//      retry.
//   2. If RETURNING returned a row: UPDATE invitations SET use_count
//      = use_count + 1 — the burn-on-commit semantic (pre-D83, this
//      fired inside validate_invitation_token's fresh-claim UPDATE,
//      collapsing arrival and commitment into one counter).
//   3. If RETURNING returned a row: INSERT audit_log row
//      (action='invitation.consent_signed', severity='info',
//      metadata={invitationId, refCode, language, audioConsent}).
// All three writes share one transaction (Postgres SECURITY DEFINER
// body); a crash in the middle rolls back atomically.
//
// Both terminal RPC outcomes (UUID returned on fresh sign, NULL on
// already-consented) route forward to /questionnaire — the downstream
// gate is `consentExistsForResponse`, which is true either way.
//
// response_id is derived from the session cookie — never passed by the
// client. Re-entry to /consent after consenting redirects forward
// (response_id is UNIQUE in consent_records; you can't re-consent).

import { redirect } from "next/navigation";
import { getSession, getLang } from "@/lib/cookies";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consentExistsForResponse } from "@/lib/repos/consent";
import { getVersion } from "@/lib/repos/questionnaires";

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

  // Re-entry pre-flight optimization: if consent already exists for
  // this response, redirect forward without calling the RPC. The RPC
  // ALSO handles this case (ON CONFLICT → returns NULL); this guard
  // just saves one round-trip when the user reaches /consent via
  // back-button after committing.
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

  // D105 — stamp the consent_text_version with the wording actually shown:
  // main respondents see the approved JUST/WDC form ("main-v1"); pilot keeps
  // "v1.0". Resolved server-side from the session's version type (never the
  // client). Unresolvable version → "v1.0" (safe, matches the pilot default).
  const version = await getVersion(admin, session.questionnaireVersionId);
  const consentTextVersion = version?.type === "main" ? "main-v1" : "v1.0";

  // D83 — atomic commit via commit_consent_sign SECURITY DEFINER RPC.
  // The RPC's body does INSERT consent_records + UPDATE invitations
  // use_count++ + INSERT audit_log inside one transaction. Idempotent
  // via ON CONFLICT — a concurrent double-submit collapses to one
  // row, no double-burn, no double-audit. Returns UUID on fresh
  // sign, NULL on already-consented; both route forward.
  const { error: rpcErr } = await admin.rpc("commit_consent_sign", {
    p_response_id: session.responseId,
    p_signed_name_encrypted: encryptedName,
    p_audio_consent: input.audioChoice === "audio",
    p_agreed_to_read: true,
    p_agreed_to_participate: true,
    p_language: lang,
    p_consent_text_version: consentTextVersion, // D105 — "main-v1" / "v1.0" (ethics trail)
  });

  if (rpcErr) {
    console.error("[consent] commit_consent_sign failed", rpcErr);
    return { ok: false, error: "server" };
  }

  redirect("/questionnaire");
}
