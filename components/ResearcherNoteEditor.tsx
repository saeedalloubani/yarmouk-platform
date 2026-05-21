"use client";

// components/ResearcherNoteEditor.tsx
//
// Researcher-note island (3c-ii). OWNER-ONLY — the detail page renders this
// only on the owner branch, so it is never sent to a readonly supervisor's
// browser at all. The action owner-gates and RLS (rn_owner_*) is the DB
// backstop. One note per response; Save upserts.

import { useState, useTransition } from "react";
import { saveResearcherNoteAction } from "@/lib/actions/notes";

export default function ResearcherNoteEditor({
  responseId,
  initialNote,
}: {
  responseId: string;
  initialNote: string;
}) {
  const [text, setText] = useState(initialNote);
  // The last successfully-persisted value. dirty compares against this (not
  // the original prop) so a successful save clears the dirty/Saved state.
  const [baseline, setBaseline] = useState(initialNote);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = text !== baseline;

  function onSave() {
    if (pending) return;
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await saveResearcherNoteAction({ responseId, noteText: text });
      if (res.ok) {
        setBaseline(text);
        setSaved(true);
      } else {
        setError(
          res.error === "forbidden"
            ? "Owner only."
            : res.error === "validation"
              ? (res.issues?.[0] ?? "Invalid note.")
              : "Something went wrong."
        );
      }
    });
  }

  return (
    <div>
      <textarea
        className="field text-[13px] min-h-[120px] w-full"
        aria-label="Researcher notes"
        placeholder="Private working notes for this response (owner only)…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          className="btn-secondary text-[13px] disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save note"}
        </button>
        {saved && !dirty && (
          <span className="text-[12px] text-accent-700">✓ Saved</span>
        )}
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}
