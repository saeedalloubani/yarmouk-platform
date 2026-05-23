"use server";

// lib/actions/recordings.ts
//
// Owner-only audio upload action for the response detail page (recordings
// layer). Mirrors lib/actions/tags.ts:
//   owner gate (+ forbidden audit for an authenticated non-owner)
//   → validate (zod)
//   → mutate (storage object + table row, via the repos)
//   → logAudit AFTER the mutation succeeds (D54).
//
// Defense in depth: the UI hides upload from readonly, the owner gate below
// refuses a readonly caller, and the recordings_obj_owner_all Storage RLS +
// recordings RLS are the DB backstop. A readonly admin reaching here is the
// security event the audit log exists for — record it (warn) before refusing.
//
// CONSENT is enforced twice: a pre-check here (no bytes are uploaded for a
// non-consenting/unverified response) AND the recordings_require_consent DB
// trigger (migration 018) as the authoritative backstop. The pre-check exists
// only to avoid orphaned bytes in the common case.
//
// AUDIT METADATA is non-PII: recordingId + sizeBytes only. file.name is NEVER
// logged — an uploaded filename can carry a participant's name (audit.ts rule).
//
// The AUTHENTICATED server client is used throughout — both repos route their
// writes through RLS. The service-role client is never imported here.

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getConsentForResponse } from "@/lib/repos/consent";
import { createRecording, getRecording } from "@/lib/repos/recordings";
import {
  uploadRecordingObject,
  deleteRecordingObject,
  getRecordingSignedUrl,
} from "@/lib/repos/recordings-storage";
import { logAudit } from "@/lib/audit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-side gate values — never trust the client for these.
const ALLOWED_TYPES: string[] = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
];
const MAX_BYTES = 52428800; // 50 MB
const EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
};

const uploadSchema = z.object({
  responseId: z.string().regex(UUID_RE, "Invalid response id"),
});

export type UploadRecordingResult =
  | { ok: true; recordingId: string }
  | {
      ok: false;
      error:
        | "forbidden"
        | "validation"
        | "no_consent"
        | "too_large"
        | "bad_type"
        | "server";
      issues?: string[];
    };

export async function uploadRecordingAction(
  formData: FormData
): Promise<UploadRecordingResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  const rawResponseId = formData.get("responseId");
  const responseIdForAudit =
    typeof rawResponseId === "string" ? rawResponseId : "";
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "recording.upload.forbidden",
        resource: responseIdForAudit,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Validate responseId (zod) + file presence.
  const rawFile = formData.get("file");
  const parsed = uploadSchema.safeParse({ responseId: rawResponseId });
  const issues: string[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => i.message);
  if (!(rawFile instanceof File)) issues.push("Audio file is required");
  if (!parsed.success || !(rawFile instanceof File)) {
    return { ok: false, error: "validation", issues };
  }
  const responseId = parsed.data.responseId;
  const file = rawFile;

  // 3. Server-side file checks (never client-trusted).
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "bad_type" };
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }

  // 4. Consent pre-check — no bytes for a non-consenting/unverified response.
  //    The DB trigger (migration 018) is the backstop; this avoids orphans.
  let consent;
  try {
    consent = await getConsentForResponse(supabase, responseId);
  } catch (err) {
    console.error("[recordings] consent pre-check failed", err);
    return { ok: false, error: "server" };
  }
  if (!consent || consent.audioConsent !== true) {
    return { ok: false, error: "no_consent" };
  }

  // 5. Derive extension + a UUID for the OBJECT filename. createRecording
  //    generates the table-row id itself (see step 7), so the object name and
  //    row id are independent — the row's audio_storage_path is the link.
  const ext = EXT_BY_TYPE[file.type] ?? "bin";
  const objectId = crypto.randomUUID();

  // 6. Upload bytes (authenticated client → recordings_obj_owner_all RLS).
  let storagePath: string;
  try {
    storagePath = await uploadRecordingObject(supabase, {
      responseId,
      recordingId: objectId,
      file,
      ext,
    });
  } catch (err) {
    console.error("[recordings] object upload failed", err);
    return { ok: false, error: "server" };
  }

  // 7 + 8. Insert the table row. On ANY insert failure, delete the just-
  //        uploaded object (best-effort) so no orphan bytes remain; map the
  //        consent-gate trigger's check_violation (23514) to no_consent.
  let recordingRowId: string;
  try {
    const created = await createRecording(supabase, {
      responseId,
      audioStoragePath: storagePath,
      audioFilename: file.name,
      audioSizeBytes: file.size,
      audioDurationSeconds: null, // duration extraction deferred (flagged)
      language: null,
      status: "audio_only",
      uploadedBy: admin.id,
    });
    recordingRowId = created.id;
  } catch (err) {
    try {
      await deleteRecordingObject(supabase, storagePath);
    } catch (cleanupErr) {
      console.error("[recordings] orphan cleanup failed", cleanupErr);
    }
    if ((err as { code?: string }).code === "23514") {
      // Pre-check passed but the trigger refused — near-impossible race.
      return { ok: false, error: "no_consent" };
    }
    console.error("[recordings] createRecording failed", err);
    return { ok: false, error: "server" };
  }

  // 9. Audit AFTER success. NON-PII only: recordingId + sizeBytes, NEVER
  //    file.name. The object + row are already valid here, so an (near-
  //    impossible) audit failure surfaces as "server" without deleting them.
  try {
    await logAudit(supabase, {
      action: "recording.upload",
      resource: responseId,
      severity: "info",
      metadata: { recordingId: recordingRowId, sizeBytes: file.size },
    });
  } catch (err) {
    console.error("[recordings] audit after upload failed", err);
    return { ok: false, error: "server" };
  }

  // 10. Done.
  return { ok: true, recordingId: recordingRowId };
}

// ---------------------------------------------------------------------------
// getRecordingPlaybackUrlAction — owner-only, lazy signed URL for playback
// ---------------------------------------------------------------------------
// A READ, so successful playbacks are NOT audited (matches the mark-read
// actions — auditing every playback fetch would flood the log without adding
// accountability the upload audit doesn't already provide). But a readonly
// admin reaching this owner-only audio action IS a security event, so we audit
// the forbidden attempt (warn), mirroring tags.ts's *.forbidden audits. Uses
// the authenticated server client, so the signed-URL call passes through the
// same recordings_obj_owner_all RLS as every other object op. Never the
// service-role client.

export async function getRecordingPlaybackUrlAction(
  recordingId: string
): Promise<
  | { ok: true; url: string }
  | { ok: false; error: "forbidden" | "not_found" | "server" }
> {
  const supabase = await createSupabaseServerClient();

  // Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "recording.playback.forbidden",
        resource: typeof recordingId === "string" ? recordingId : "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // Malformed id → not_found (keeps a UUID-cast error from surfacing as
  // "server"; ids come from our own server-rendered list, so this is belt-and-
  // suspenders).
  if (!UUID_RE.test(recordingId)) {
    return { ok: false, error: "not_found" };
  }

  try {
    const recording = await getRecording(supabase, recordingId);
    if (!recording || !recording.audioStoragePath) {
      return { ok: false, error: "not_found" };
    }
    const url = await getRecordingSignedUrl(
      supabase,
      recording.audioStoragePath
    );
    return { ok: true, url };
  } catch (err) {
    console.error("[recordings] getRecordingPlaybackUrl failed", err);
    return { ok: false, error: "server" };
  }
}
