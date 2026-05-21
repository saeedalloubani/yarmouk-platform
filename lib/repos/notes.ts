// lib/repos/notes.ts
//
// Admin-side read + write for `researcher_notes` (3c-ii) — the researcher's
// PRIVATE working annotations, ONE per response (response_id is the PK).
//
// OWNER-ONLY, and that boundary is REAL at the DB layer: migration 16
// replaced the old both-roles rn_admins_select with rn_owner_select, so a
// read-only supervisor reading this table directly (PostgREST) gets ZERO
// rows. The detail page additionally only fetches notes on the owner branch,
// and saveResearcherNoteAction owner-gates before writing — three layers.
//
// This is NOT a redaction (no redacted view, no null-driven masking). Notes
// are a wholesale owner-only FEATURE: absent for readonly, not redacted.
// That distinction is deliberate (see 3c-ii notes vs. 3c-i identity path).
//
// NON-PII metadata rule still holds at the audit layer: the note BODY never
// goes into audit_log — the action logs a char count only.
//
// Takes the AUTHENTICATED server client so RLS applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

export type ResearcherNote = {
  noteText: string;
  updatedAt: string;
};

/**
 * The note for one response, or null if none exists yet. Returns null (not
 * an error) for a readonly caller too — rn_owner_select yields no row — but
 * the page never calls this off the owner branch anyway.
 */
export async function getResearcherNote(
  supabase: SupabaseClient<Database>,
  responseId: string
): Promise<ResearcherNote | null> {
  const { data, error } = await supabase
    .from("researcher_notes")
    .select("note_text, updated_at")
    .eq("response_id", responseId)
    .maybeSingle();
  if (error) throw error;
  return data ? { noteText: data.note_text, updatedAt: data.updated_at } : null;
}

/**
 * Create or update the single note for a response (upsert on the response_id
 * PK). Stamps updated_at + updated_by. Owner-gated by the calling action and
 * by RLS (rn_owner_insert / rn_owner_update).
 */
export async function upsertResearcherNote(
  supabase: SupabaseClient<Database>,
  responseId: string,
  noteText: string,
  adminId: string
): Promise<void> {
  const { error } = await supabase.from("researcher_notes").upsert(
    {
      response_id: responseId,
      note_text: noteText,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    },
    { onConflict: "response_id" }
  );
  if (error) throw error;
}
