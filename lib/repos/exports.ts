// lib/repos/exports.ts
//
// D74 — read-aggregation for the Pilot Response Export Center
// (/admin/exports). Long-format (1 row per response × answer), 18
// denormalized columns, PII decrypted for the owner.
//
// ACCESS POSTURE — OWNER-ONLY BY CONSTRUCTION. This repo deliberately
// queries the `invitations` BASE TABLE directly (not invitations_redacted),
// because the only call sites (app/admin/(protected)/exports/page.tsx +
// app/admin/(protected)/exports/download/route.ts) redirect/403 non-owners
// BEFORE this repo loads. A readonly admin reaching this code path is a
// programming error; the page-level owner gate is the contract.
//
// PII DECRYPT POSTURE — ALL-OR-NOTHING. Iterates invitations, calling
// decrypt_pii for recipient_name + recipient_email. The FIRST decrypt
// failure throws ExportDecryptFailedError; no partial export is ever
// returned. The route handler catches this, writes a warn-severity audit
// row with errorClass='config' (never error.message), and surfaces a safe
// banner to the user. error.message from the Vault RPC can echo recipient
// PII in unusual key-rotation states and is NEVER logged or persisted.
//
// EXCLUDED BY DESIGN:
//   - token_hash + token_plaintext_encrypted + access_code_encrypted —
//     one-time auth secrets, NOT research data (RUNBOOK-recovery
//     artifacts only).
//   - consent_records.signed_name_encrypted — col 12 is the timestamp
//     only (boolean-equivalent: signed_at non-null ⇒ consent given). The
//     participant's name in the invitation row (col 2) is the canonical
//     identity; the consent signature is a legal artifact, not analytical
//     data.
//
// FILTERS — submitted + ACTIVE responses only (matches D63 cross-cutting
// filter map for analytical surfaces). Withdrawn participants must not
// appear in the analytical dataset. is_locked is NOT a filter (lock = edit
// gating, not analytical exclusion).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type ExportRow = {
  refCode: string;
  recipientName: string;
  recipientEmail: string;
  category: string;
  nationality: string | null;
  preferredLanguage: string;
  collectionMode: string;
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string;
  submittedAt: string;
  consentSignedAt: string | null;
  questionCode: string;
  questionOrderIndex: number;
  isFeedback: boolean;
  questionTextEn: string;
  questionTextAr: string;
  answerText: string;
};

export type ExportScope =
  | { scope: "single"; responseId: string }
  | { scope: "bulk" };

/**
 * Thrown when ANY decrypt_pii call returns an error or null. Carries the
 * ref_code that failed so the route handler can record forensic context
 * — never the underlying error.message (PII echo risk).
 */
export class ExportDecryptFailedError extends Error {
  constructor(public readonly refCode: string) {
    super(`PII decrypt failed for invitation ${refCode}`);
    this.name = "ExportDecryptFailedError";
  }
}

/**
 * Long-format response export. Returns [] when no submitted+active
 * responses match (the route handler treats single-empty as 404 and
 * bulk-empty as a header-only file).
 *
 * ALL-OR-NOTHING decrypt: if any of the matched invitations' name or
 * email fails to decrypt, throws ExportDecryptFailedError before any
 * row is returned. No partial output is possible.
 */
export async function getResponsesForExport(
  supabase: SupabaseClient<Database>,
  scope: ExportScope
): Promise<ExportRow[]> {
  // 1. Responses — submitted + active only.
  let rq = supabase
    .from("responses")
    .select("id, invitation_id, language, started_at, submitted_at, status")
    .not("submitted_at", "is", null)
    .eq("status", "active")
    .order("submitted_at", { ascending: true });
  if (scope.scope === "single") rq = rq.eq("id", scope.responseId);
  const { data: respRows, error: rErr } = await rq;
  if (rErr) throw rErr;
  const responses = respRows ?? [];
  if (responses.length === 0) return [];

  const invitationIds = Array.from(
    new Set(responses.map((r) => r.invitation_id))
  );
  const responseIds = responses.map((r) => r.id);

  // 2. Invitations — BASE TABLE (owner-only call site). Pulls the two
  //    PII ciphertexts plus the operational columns we need for the
  //    export grid.
  const { data: invRows, error: iErr } = await supabase
    .from("invitations")
    .select(
      "id, ref_code, recipient_name_encrypted, recipient_email_encrypted, category, nationality, preferred_language, collection_mode, sent_at, opened_at"
    )
    .in("id", invitationIds);
  if (iErr) throw iErr;
  const invitations = invRows ?? [];

  // 3. Decrypt PII per invitation — ALL OR NOTHING. The first failure
  //    aborts the entire export. We log only the ref_code + errorClass
  //    bucket; the underlying RPC error.message is never persisted or
  //    surfaced.
  type InvDecrypted = {
    refCode: string;
    name: string;
    email: string;
    category: string;
    nationality: string | null;
    preferredLanguage: string;
    collectionMode: string;
    sentAt: string | null;
    openedAt: string | null;
  };
  const invById = new Map<string, InvDecrypted>();
  for (const inv of invitations) {
    const { data: name, error: nErr } = await supabase.rpc("decrypt_pii", {
      p_ciphertext: inv.recipient_name_encrypted,
    });
    if (nErr || name == null) {
      console.error(
        "[exports] decrypt_pii(name) failed for",
        inv.ref_code,
        "errorClass=config"
      );
      throw new ExportDecryptFailedError(inv.ref_code);
    }
    const { data: email, error: eErr } = await supabase.rpc("decrypt_pii", {
      p_ciphertext: inv.recipient_email_encrypted,
    });
    if (eErr || email == null) {
      console.error(
        "[exports] decrypt_pii(email) failed for",
        inv.ref_code,
        "errorClass=config"
      );
      throw new ExportDecryptFailedError(inv.ref_code);
    }
    invById.set(inv.id, {
      refCode: inv.ref_code,
      name,
      email,
      category: inv.category,
      nationality: inv.nationality,
      preferredLanguage: inv.preferred_language,
      collectionMode: inv.collection_mode,
      sentAt: inv.sent_at,
      openedAt: inv.opened_at,
    });
  }

  // 4. Consent timestamps — boolean-equivalent (col 12). signed_name_encrypted
  //    is deliberately NOT read (D74 design call).
  const { data: consentRows, error: cErr } = await supabase
    .from("consent_records")
    .select("response_id, signed_at")
    .in("response_id", responseIds);
  if (cErr) throw cErr;
  const consentByResponse = new Map(
    (consentRows ?? []).map((c) => [c.response_id, c.signed_at] as const)
  );

  // 5. Answers — join target.
  const { data: ansRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, question_id, answer_text")
    .in("response_id", responseIds);
  if (aErr) throw aErr;
  const answers = ansRows ?? [];
  if (answers.length === 0) return [];

  // 6. Questions — denormalized join. Pull metadata for every distinct
  //    question_id referenced by the answers above.
  const questionIds = Array.from(new Set(answers.map((a) => a.question_id)));
  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select("id, question_code, order_index, is_feedback, text_en, text_ar")
    .in("id", questionIds);
  if (qErr) throw qErr;
  const questionById = new Map((qRows ?? []).map((q) => [q.id, q] as const));

  // 7. Flatten to long-format. Outer sort: responses are already in
  //    submitted_at ASC order (step 1). Inner sort: question.order_index
  //    ASC. Defensive guards drop any answer whose question metadata
  //    isn't in questionById (impossible given the IN clause, but cheap).
  const out: ExportRow[] = [];
  for (const resp of responses) {
    const inv = invById.get(resp.invitation_id);
    if (!inv) continue;
    const consentSignedAt = consentByResponse.get(resp.id) ?? null;
    const respAnswers = answers
      .filter((a) => a.response_id === resp.id)
      .map((a) => {
        const q = questionById.get(a.question_id);
        return q ? { a, q } : null;
      })
      .filter((x): x is { a: (typeof answers)[number]; q: NonNullable<ReturnType<typeof questionById.get>> } => x !== null)
      .sort((x, y) => x.q.order_index - y.q.order_index);
    for (const { a, q } of respAnswers) {
      out.push({
        refCode: inv.refCode,
        recipientName: inv.name,
        recipientEmail: inv.email,
        category: inv.category,
        nationality: inv.nationality,
        preferredLanguage: inv.preferredLanguage,
        collectionMode: inv.collectionMode,
        sentAt: inv.sentAt,
        openedAt: inv.openedAt,
        startedAt: resp.started_at,
        // The query filter (.not('submitted_at', 'is', null)) narrows
        // this to non-null at runtime; the TS type widens because the
        // generated column type is `string | null`.
        submittedAt: resp.submitted_at as string,
        consentSignedAt,
        questionCode: q.question_code,
        questionOrderIndex: q.order_index,
        isFeedback: q.is_feedback,
        questionTextEn: q.text_en,
        questionTextAr: q.text_ar,
        answerText: a.answer_text,
      });
    }
  }
  return out;
}
