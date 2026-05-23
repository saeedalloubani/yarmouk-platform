"use client";

// components/RecordingsSection.tsx
//
// Owner-only audio upload + playback island for the response detail page.
// Rendered ONLY when the response's audio consent is true (the parent page
// gates on consent.audioConsent === true). Mirrors InvitationResendButton's
// loud-failure surface: a notice-warn panel on upload failure, text-accent-700
// success, text-danger for per-row errors.
//
// Client-side file checks are UX-only instant feedback; the server action
// re-validates everything (type, size, consent) and IS the real boundary —
// client input is never trusted. Playback signs LAZILY: a recording's signed
// URL is fetched only when its Play button is clicked, never pre-signed for the
// whole list on load (no URLs are sent to the browser at render time).

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import {
  uploadRecordingAction,
  getRecordingPlaybackUrlAction,
  type UploadRecordingResult,
} from "@/lib/actions/recordings";

type RecordingRow = {
  id: string;
  filename: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

type PlaybackState = { url?: string; error?: string; loading?: boolean };

// Mirror the server allow-list + size cap for instant client feedback.
const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
];
const MAX_BYTES = 52428800; // 50 MB

const UPLOAD_ERROR_MSG: Record<string, string> = {
  no_consent: "This participant did not consent to audio recording.",
  too_large: "File exceeds the 50 MB limit.",
  bad_type: "Only audio files are accepted.",
  validation: "Please select a valid audio file.",
  forbidden: "Owner only.",
  server: "Upload failed — please try again.",
};

const PLAYBACK_ERROR_MSG: Record<string, string> = {
  forbidden: "Owner only.",
  not_found: "Recording not found.",
  server: "Couldn't load — please try again.",
};

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RecordingsSection({
  responseId,
  initialRecordings,
}: {
  responseId: string;
  initialRecordings: RecordingRow[];
}) {
  const [recordings, setRecordings] =
    useState<RecordingRow[]>(initialRecordings);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadRecordingResult | null>(null);
  const [playback, setPlayback] = useState<Record<string, PlaybackState>>({});
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setResult(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setSelectedFile(null);
      setClientError(null);
      return;
    }
    // UX-only pre-validation (the server re-checks authoritatively).
    if (!f.type.startsWith("audio/") || !ALLOWED_TYPES.includes(f.type)) {
      setClientError("Only audio files are accepted (mp3, m4a, wav, webm).");
      setSelectedFile(null);
      return;
    }
    if (f.size <= 0 || f.size > MAX_BYTES) {
      setClientError("File exceeds the 50 MB limit.");
      setSelectedFile(null);
      return;
    }
    setClientError(null);
    setSelectedFile(f);
  }

  function onUpload() {
    if (pending || !selectedFile) return;
    const file = selectedFile; // capture before state clears
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("responseId", responseId);
      fd.append("file", file);
      const res = await uploadRecordingAction(fd);
      setResult(res);
      if (res.ok) {
        setRecordings((prev) => [
          {
            id: res.recordingId,
            filename: file.name,
            sizeBytes: file.size,
            uploadedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setSelectedFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  async function onPlay(id: string) {
    setPlayback((p) => ({ ...p, [id]: { loading: true } }));
    const res = await getRecordingPlaybackUrlAction(id);
    if (res.ok) {
      setPlayback((p) => ({ ...p, [id]: { url: res.url } }));
    } else {
      setPlayback((p) => ({
        ...p,
        [id]: { error: PLAYBACK_ERROR_MSG[res.error] ?? "Couldn't load." },
      }));
    }
  }

  return (
    <div>
      {/* Upload control */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          onChange={onFileChange}
          disabled={pending}
          className="text-[12px] text-muted disabled:opacity-40"
        />
        <button
          type="button"
          onClick={onUpload}
          disabled={pending || !selectedFile}
          className="btn-secondary text-[12px] disabled:opacity-40"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>

      {clientError && (
        <div className="text-[12px] text-danger mt-2">{clientError}</div>
      )}

      {result?.ok && (
        <div className="text-[12px] text-accent-700 mt-2">✓ Uploaded</div>
      )}

      {result && !result.ok && (
        <div className="notice-warn mt-2 text-[12px]">
          {UPLOAD_ERROR_MSG[result.error] ?? "Upload failed — please try again."}
        </div>
      )}

      {/* List + lazy playback */}
      <div className="mt-4 divide-y divide-line border-t border-line">
        {recordings.length === 0 ? (
          <p className="text-[13px] text-muted pt-3">No recordings yet.</p>
        ) : (
          recordings.map((r) => {
            const pb = playback[r.id];
            return (
              <div key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink truncate">
                      {r.filename ?? "recording"}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {fmtSize(r.sizeBytes)} · {fmtDateTime(r.uploadedAt)}
                    </div>
                  </div>
                  {!pb?.url && (
                    <button
                      type="button"
                      onClick={() => onPlay(r.id)}
                      disabled={pb?.loading}
                      className="btn-ghost text-[12px] disabled:opacity-40 flex-shrink-0"
                    >
                      {pb?.loading ? "Loading…" : "Play"}
                    </button>
                  )}
                </div>
                {pb?.url && (
                  <audio controls src={pb.url} className="mt-2 w-full">
                    Your browser does not support audio playback.
                  </audio>
                )}
                {pb?.error && (
                  <div className="text-[12px] text-danger mt-1">{pb.error}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
