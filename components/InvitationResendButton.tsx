"use client";

// components/InvitationResendButton.tsx
//
// Per-row resend control (owner-only; rendered only when isOwner). The
// invitations list stays a Server Component — this is the one interactive
// island. Calls resendInvitationAction, which rotates the token AND the
// access code (D66) + re-sends (D56 / D66).
//
// LOUD-FAILURE SURFACE (D56): on a successful rotation whose EMAIL failed
// (ok + !emailed), the old URL + code are already dead and the new
// values exist only in the returned tokenUrl + accessCode — so we show
// a prominent warning panel with BOTH + per-row copy buttons.
//
// D66 — both the email-sent success branch AND the loud-failure branch
// now reveal the URL + the 6-digit access code in a stacked panel. The
// "shown once" wording applies to the code identically (resend rotates
// both; the OLD code is dead the instant access_code_encrypted is
// overwritten by the rotation UPDATE).
//
// D81 Item 4 — icon-only trigger button. Text label ("Resend" / "Resending…")
// replaced by an inline RotateCw SVG (lucide-style geometry, hand-coded,
// no new dep). aria-label embeds the refCode, title gives a hover tooltip,
// disabled:opacity-40 retained from the prior text button as the pending
// affordance. The reveal panels + error variants below are UNCHANGED — only
// the trigger button surface gets the icon treatment.

import { useState, useTransition } from "react";
import {
  resendInvitationAction,
  type ResendInvitationResult,
} from "@/lib/actions/invitations";

// D66 — per-field copy state so URL and code can each show "Copied"
// independently.
type CopiedField = null | "tokenUrl" | "accessCode";

// D81 Item 4 — RotateCw icon (lucide geometry, hand-coded inline).
// stroke-width=2 matches Bell (SendReminder) + Trash2 (Revoke) for
// consistent visual weight across the action bar.
function RotateCwIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export default function InvitationResendButton({
  invitationId,
  refCode,
}: {
  invitationId: string;
  refCode: string;
}) {
  const [result, setResult] = useState<ResendInvitationResult | null>(null);
  const [copied, setCopied] = useState<CopiedField>(null);
  const [pending, startTransition] = useTransition();

  function onResend() {
    if (pending) return;
    const ok = window.confirm(
      `Resend ${refCode}? The current link and code stop working immediately and a new pair is issued.`
    );
    if (!ok) return;
    setResult(null);
    setCopied(null);
    startTransition(async () => {
      setResult(await resendInvitationAction(invitationId));
    });
  }

  // D66 — stacked URL+code panel rendered for BOTH success branches.
  // Tone differs (success vs warn), copy content is identical.
  function RevealPanel({
    tokenUrl,
    accessCode,
    headline,
  }: {
    tokenUrl: string;
    accessCode: string;
    headline: React.ReactNode;
  }) {
    return (
      <div>
        {headline}
        <div className="label mb-1 mt-2">Invitation link — shown once</div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            aria-label="Invitation URL"
            className="field mono text-[11px] flex-1"
            value={tokenUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(tokenUrl);
              setCopied("tokenUrl");
            }}
          >
            {copied === "tokenUrl" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="label mb-1 mt-3">Access code</div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            aria-label="6-digit access code"
            className="field mono text-center tracking-widest text-[14px] flex-1"
            value={accessCode}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(accessCode);
              setCopied("accessCode");
            }}
          >
            {copied === "accessCode" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">
          Share with the recipient if their email service blocked the link
          above.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onResend}
        disabled={pending}
        aria-label={`Resend ${refCode} — rotate token + access code`}
        title={pending ? "Resending…" : "Resend (rotates link + code)"}
        className="btn-ghost inline-flex items-center justify-center w-8 h-8 p-0 disabled:opacity-40"
      >
        <RotateCwIcon />
      </button>

      {result?.ok && result.emailed && (
        <div className="notice-success mt-2 text-[12px]">
          <RevealPanel
            tokenUrl={result.tokenUrl}
            accessCode={result.accessCode}
            headline={
              <div>
                ✓ Resent ({result.mode}). The previous link and code are now
                dead.
              </div>
            }
          />
        </div>
      )}

      {result?.ok && !result.emailed && (
        <div className="notice-warn mt-2 text-[12px]">
          <RevealPanel
            tokenUrl={result.tokenUrl}
            accessCode={result.accessCode}
            headline={
              <div>
                <strong>
                  The old link and code are now dead, and the email did NOT
                  send.
                </strong>{" "}
                Copy and deliver these now — they are shown once:
              </div>
            }
          />
        </div>
      )}

      {result && !result.ok && (
        <div className="text-[12px] text-danger mt-1">
          {result.error === "already_submitted" &&
            "Already submitted — cannot resend."}
          {result.error === "forbidden" && "Owner only."}
          {result.error === "not_found" && "Invitation not found."}
          {result.error === "server" && "Something went wrong."}
        </div>
      )}
    </div>
  );
}
