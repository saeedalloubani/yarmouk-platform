"use client";

// components/SubmissionPrefsForm.tsx
//
// Submission-notification preferences island (Session — notification
// preferences). OWNER-ONLY (the settings page renders it only on the owner
// branch). SAVE-ON-FLIP: toggling a switch immediately upserts BOTH columns
// via saveMySubmissionPrefs (the action writes both every time, so we always
// send both current values — the flipped one + the other's current state).
//
// OPTIMISTIC + FAILURE REVERT (load-bearing): the switch flips visually on
// click, then the action runs; if it returns { ok: false } or throws, we
// REVERT the switch to its previous state and show a loud error — a toggle
// must never show a state the server didn't accept (mirrors the loud-failure
// surface in InvitationResendButton).

import { useState, useTransition } from "react";
import { saveMySubmissionPrefs } from "@/lib/actions/settings";

export default function SubmissionPrefsForm({
  initialInapp,
  initialEmail,
}: {
  initialInapp: boolean;
  initialEmail: boolean;
}) {
  const [inapp, setInapp] = useState(initialInapp);
  const [email, setEmail] = useState(initialEmail);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(channel: "inapp" | "email") {
    if (pending) return;
    setSaved(false);
    setError(false);

    // Snapshot for revert; compute the next state (only one channel flips).
    const prevInapp = inapp;
    const prevEmail = email;
    const nextInapp = channel === "inapp" ? !inapp : inapp;
    const nextEmail = channel === "email" ? !email : email;

    // Optimistic: reflect the flip immediately.
    setInapp(nextInapp);
    setEmail(nextEmail);

    startTransition(async () => {
      try {
        // Always send BOTH columns — the upsert writes both every time.
        const res = await saveMySubmissionPrefs({
          submissionInapp: nextInapp,
          submissionEmail: nextEmail,
        });
        if (res.ok) {
          setSaved(true);
        } else {
          // Revert — never leave a toggle showing a state the server rejected.
          setInapp(prevInapp);
          setEmail(prevEmail);
          setError(true);
        }
      } catch {
        setInapp(prevInapp);
        setEmail(prevEmail);
        setError(true);
      }
    });
  }

  return (
    <div>
      <div className="divide-y divide-line">
        <ToggleRow
          id="submission-inapp"
          label="In-app notifications"
          description="Get a bell alert when a response is submitted."
          checked={inapp}
          disabled={pending}
          onToggle={() => toggle("inapp")}
        />
        <ToggleRow
          id="submission-email"
          label="Email notifications"
          description="Get an email when a response is submitted."
          checked={email}
          disabled={pending}
          onToggle={() => toggle("email")}
        />
      </div>

      {/* Status region — polite live region so SR users hear Saving/Saved/error. */}
      <div className="mt-3 min-h-[20px]" aria-live="polite">
        {pending && <span className="text-[12px] text-muted">Saving…</span>}
        {!pending && saved && (
          <span className="text-[12px] text-accent-700">✓ Saved</span>
        )}
        {!pending && error && (
          <div className="notice-warn text-[12px]">
            Couldn&apos;t save — please try again.
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div id={labelId} className="text-[13px] font-semibold text-ink">
          {label}
        </div>
        <div id={descId} className="text-[12px] text-muted mt-0.5">
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-40 ${
          checked ? "bg-brand-700" : "bg-line"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
