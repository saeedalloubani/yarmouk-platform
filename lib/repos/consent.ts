// lib/repos/consent.ts
//
// Data access for `consent_records`.
//   - Owner reads     → base table (signed_name_encrypted ciphertext visible)
//   - Read-only reads → `consent_records_redacted` view (signed_name_encrypted
//                       is NULL; other fields visible so supervisors can verify
//                       "consent was given for this response")
//   - All writes      → base table (Owner-only via RLS)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { getCurrentAdminRole } from "../auth";

type DbRow = Database["public"]["Tables"]["consent_records"]["Row"];
type DbViewRow = Database["public"]["Views"]["consent_records_redacted"]["Row"];
type DbInsert = Database["public"]["Tables"]["consent_records"]["Insert"];

export type ConsentRecord = {
  id: string;
  responseId: string;
  /** NULL when caller is a read-only admin (view masks the column). */
  signedNameEncrypted: string | null;
  signedAt: string;
  audioConsent: boolean;
  agreedToRead: boolean;
  agreedToParticipate: boolean;
  consentTextVersion: string;
  language: "en" | "ar";
};

function rowToConsent(row: DbRow | DbViewRow): ConsentRecord {
  // PG view metadata doesn't carry NOT NULL info, so generated DbViewRow
  // types every column as nullable. At runtime the view returns base-table
  // values verbatim for non-redacted columns. We cast to DbRow to recover
  // the schema's actual non-null guarantees. signed_name_encrypted is
  // genuinely NULL in the view, so we access it via the original `row`
  // reference where the union nullability (string | null) is honest.
  // language is narrowed via `as 'en' | 'ar'` because the DB CHECK
  // constraint enforces this but Supabase's gen types don't reflect CHECK.
  const r = row as DbRow;
  return {
    id: r.id,
    responseId: r.response_id,
    signedNameEncrypted: row.signed_name_encrypted,
    signedAt: r.signed_at,
    audioConsent: r.audio_consent,
    agreedToRead: r.agreed_to_read,
    agreedToParticipate: r.agreed_to_participate,
    consentTextVersion: r.consent_text_version,
    language: r.language as "en" | "ar",
  };
}

/** Get the consent record for a response. Null if none signed yet. */
export async function getConsentForResponse(
  supabase: SupabaseClient<Database>,
  responseId: string
): Promise<ConsentRecord | null> {
  const role = await getCurrentAdminRole(supabase);
  if (role === "owner") {
    const { data, error } = await supabase
      .from("consent_records")
      .select("*")
      .eq("response_id", responseId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToConsent(data) : null;
  }
  const { data, error } = await supabase
    .from("consent_records_redacted")
    .select("*")
    .eq("response_id", responseId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToConsent(data) : null;
}

export type CreateConsentInput = {
  responseId: string;
  /** Already pgcrypto-encrypted by lib/encryption.ts. */
  signedNameEncrypted: string;
  audioConsent: boolean;
  agreedToRead: boolean;
  agreedToParticipate: boolean;
  language: "en" | "ar";
  consentTextVersion?: string;
};

export async function createConsentRecord(
  supabase: SupabaseClient<Database>,
  input: CreateConsentInput
): Promise<ConsentRecord> {
  const insert: DbInsert = {
    response_id: input.responseId,
    signed_name_encrypted: input.signedNameEncrypted,
    audio_consent: input.audioConsent,
    agreed_to_read: input.agreedToRead,
    agreed_to_participate: input.agreedToParticipate,
    language: input.language,
    consent_text_version: input.consentTextVersion ?? "v1.0",
  };
  const { data, error } = await supabase
    .from("consent_records")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return rowToConsent(data);
}

// ---------------------------------------------------------------------------
// Public-flow helpers (D48): the respondent flow has no admin role, so these
// take the service-role admin client and never call getCurrentAdminRole.
// They keep consent (a PII table) access inside this repo per D31, while the
// caller (lib/actions/consent.ts) owns validation, encryption, and redirects.
// ---------------------------------------------------------------------------

/** Existence check for the consent gate (re-entry guard + questionnaire gate). */
export async function consentExistsForResponse(
  admin: SupabaseClient<Database>,
  responseId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("consent_records")
    .select("response_id")
    .eq("response_id", responseId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export type InsertConsentInput = {
  responseId: string;
  /** Already pgcrypto-encrypted (encrypt_pii) by the caller. */
  signedNameEncrypted: string;
  audioConsent: boolean;
  agreedToRead: boolean;
  agreedToParticipate: boolean;
  language: "en" | "ar";
  consentTextVersion?: string;
};

/** Public-flow insert. Returns the PostgrestError (if any) instead of
 *  throwing, so the caller can detect unique_violation (23505) — a
 *  concurrent double-submit on the UNIQUE response_id. */
export async function insertConsentRecord(
  admin: SupabaseClient<Database>,
  input: InsertConsentInput
): Promise<{ error: { code?: string } | null }> {
  const { error } = await admin.from("consent_records").insert({
    response_id: input.responseId,
    signed_name_encrypted: input.signedNameEncrypted,
    audio_consent: input.audioConsent,
    agreed_to_read: input.agreedToRead,
    agreed_to_participate: input.agreedToParticipate,
    language: input.language,
    consent_text_version: input.consentTextVersion ?? "v1.0",
  });
  return { error };
}
