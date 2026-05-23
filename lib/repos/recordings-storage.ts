// lib/repos/recordings-storage.ts
//
// Storage-OBJECT access for audio in the 'recordings' bucket — the BYTES,
// kept separate from the table-row repo (lib/repos/recordings.ts, which owns
// the metadata rows). The AUTHENTICATED server client is REQUIRED here:
// every operation passes through the recordings_obj_owner_all Storage RLS
// policy (migration 018), which authorizes the call by resolving
// current_admin_role() = 'owner' against the caller's JWT. NEVER pass the
// service-role client — it bypasses RLS and therefore bypasses the proven
// owner-only boundary. Table-row writes stay in recordings.ts; this file only
// moves bytes.
//
// Object paths are RELATIVE to the bucket: the bucket name is the
// .from('recordings') argument, so the path is
// `${responseId}/${recordingId}.${ext}` — NOT prefixed with 'recordings/'.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

const BUCKET = "recordings";

/** Upload audio bytes; returns the bucket-relative storage path. Throws on error. */
export async function uploadRecordingObject(
  supabase: SupabaseClient<Database>,
  {
    responseId,
    recordingId,
    file,
    ext,
  }: { responseId: string; recordingId: string; file: File; ext: string }
): Promise<string> {
  const path = `${responseId}/${recordingId}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Remove an object (orphan cleanup). Throws on error. */
export async function deleteRecordingObject(
  supabase: SupabaseClient<Database>,
  storagePath: string
): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

/** Short-lived signed URL for owner playback/download. 7200s = 2 hours. Throws on error. */
export async function getRecordingSignedUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
  expiresInSeconds = 7200
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw error ?? new Error("Failed to sign recording URL");
  return data.signedUrl;
}
