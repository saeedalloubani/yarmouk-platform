// lib/repos/recordings.ts
//
// Data access for the `recordings` table.
//   - Owner reads     → base table (audio path, original transcript,
//                       substitution key are all readable)
//   - Read-only reads → `recordings_redacted` (audio_storage_path,
//                       transcript_original, substitution_key are NULL;
//                       transcript_anonymized is NULL unless
//                       status = 'published' — see D16)
//   - All writes      → base table (Owner only via RLS)
//
// See invitations.ts for the why-we-inline-branch comment.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { getCurrentAdminRole } from "../auth";

type DbRow = Database["public"]["Tables"]["recordings"]["Row"];
type DbViewRow = Database["public"]["Views"]["recordings_redacted"]["Row"];
type DbInsert = Database["public"]["Tables"]["recordings"]["Insert"];
type DbUpdate = Database["public"]["Tables"]["recordings"]["Update"];

export type TranscriptStatusValue =
  | "audio_only"
  | "transcribing"
  | "transcribed"
  | "anonymizing"
  | "published";

export type Recording = {
  id: string;
  responseId: string;
  /** NULL for read-only admins. */
  audioStoragePath: string | null;
  audioFilename: string | null;
  audioDurationSeconds: number | null;
  audioSizeBytes: number | null;
  /** NULL for read-only admins. */
  transcriptOriginal: string | null;
  /** NULL for read-only admins unless status === 'published'. */
  transcriptAnonymized: string | null;
  /** NULL for read-only admins. */
  substitutionKey: Record<string, string> | null;
  language: "en" | "ar" | null;
  status: TranscriptStatusValue;
  uploadedBy: string | null;
  uploadedAt: string;
  publishedAt: string | null;
};

function rowToRecording(row: DbRow | DbViewRow): Recording {
  return {
    id: row.id,
    responseId: row.response_id,
    audioStoragePath: row.audio_storage_path,
    audioFilename: row.audio_filename,
    audioDurationSeconds: row.audio_duration_seconds,
    audioSizeBytes: row.audio_size_bytes,
    transcriptOriginal: row.transcript_original,
    transcriptAnonymized: row.transcript_anonymized,
    substitutionKey: row.substitution_key as Record<string, string> | null,
    language: row.language,
    status: row.status,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    publishedAt: row.published_at,
  };
}

// ---------- Reads ----------

export async function getRecording(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Recording | null> {
  const role = await getCurrentAdminRole(supabase);
  if (role === "owner") {
    const { data, error } = await supabase
      .from("recordings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRecording(data) : null;
  }
  const { data, error } = await supabase
    .from("recordings_redacted")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToRecording(data) : null;
}

export type ListRecordingsFilter = {
  responseId?: string;
  status?: TranscriptStatusValue;
  limit?: number;
};

export async function listRecordings(
  supabase: SupabaseClient<Database>,
  filter: ListRecordingsFilter = {}
): Promise<Recording[]> {
  const role = await getCurrentAdminRole(supabase);

  if (role === "owner") {
    let q = supabase
      .from("recordings")
      .select("*")
      .order("uploaded_at", { ascending: false });
    if (filter.responseId) q = q.eq("response_id", filter.responseId);
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToRecording);
  }

  let q = supabase
    .from("recordings_redacted")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (filter.responseId) q = q.eq("response_id", filter.responseId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.limit) q = q.limit(filter.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToRecording);
}

// ---------- Writes ----------

export type CreateRecordingInput = {
  responseId: string;
  audioStoragePath?: string | null;
  audioFilename?: string | null;
  audioDurationSeconds?: number | null;
  audioSizeBytes?: number | null;
  language?: "en" | "ar" | null;
  status?: TranscriptStatusValue;
  uploadedBy?: string | null;
};

export async function createRecording(
  supabase: SupabaseClient<Database>,
  input: CreateRecordingInput
): Promise<Recording> {
  const insert: DbInsert = {
    response_id: input.responseId,
    audio_storage_path: input.audioStoragePath ?? null,
    audio_filename: input.audioFilename ?? null,
    audio_duration_seconds: input.audioDurationSeconds ?? null,
    audio_size_bytes: input.audioSizeBytes ?? null,
    language: input.language ?? null,
    status: input.status ?? "audio_only",
    uploaded_by: input.uploadedBy ?? null,
    transcript_original: null,
    transcript_anonymized: null,
    substitution_key: null,
    published_at: null,
  };
  const { data, error } = await supabase
    .from("recordings")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return rowToRecording(data);
}

export type UpdateRecordingInput = Partial<{
  status: TranscriptStatusValue;
  transcriptOriginal: string | null;
  transcriptAnonymized: string | null;
  substitutionKey: Record<string, string> | null;
  publishedAt: string | null;
}>;

export async function updateRecording(
  supabase: SupabaseClient<Database>,
  id: string,
  input: UpdateRecordingInput
): Promise<Recording> {
  const update: DbUpdate = {};
  if (input.status !== undefined) update.status = input.status;
  if (input.transcriptOriginal !== undefined)
    update.transcript_original = input.transcriptOriginal;
  if (input.transcriptAnonymized !== undefined)
    update.transcript_anonymized = input.transcriptAnonymized;
  if (input.substitutionKey !== undefined)
    update.substitution_key = input.substitutionKey;
  if (input.publishedAt !== undefined)
    update.published_at = input.publishedAt;

  const { data, error } = await supabase
    .from("recordings")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToRecording(data);
}
