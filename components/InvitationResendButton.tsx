"use client";

// components/InvitationResendButton.tsx
//
// Per-row resend control (owner-only; rendered only when isOwner). The
// invitations list stays a Server Component — this is the one interactive
// island. Calls resendInvitationAction, which rotates the token (old link
// dies) + re-sends (D56).
//
// LOUD-FAILURE SURFACE (D56): on a successful rotation whose EMAIL failed
// (ok + !emailed), the old link is already dead and the new link exists
// only in the returned tokenUrl — so we show a prominent warning panel
// with the link + copy, not a quiet note.

import { useState, useTransition } from "react";
import {
  resendInvitationAction,
  type ResendInvitationResult,
} from "@/lib/actions/invitations";

export default function InvitationResendButton({
  invitationId,
  refCode,
}: {
  invitationId: string;
  refCode: string;
}) {
  const [result, setResult] = useState<ResendInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function onResend() {
    if (pending) return;
    const ok = window.confirm(
      `Resend ${refCode}? The current link stops working immediately and a new one is issued.`
    );
    if (!ok) return;
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      setResult(await resendInvitationAction(invitationId));
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onResend}
        disabled={pending}
        className="btn-ghost text-[12px] disabled:opacity-40"
      >
        {pending ? "Resending…" : "Resend"}
      </button>

      {result?.ok && result.emailed && (
        <div className="text-[12px] text-accent-700 mt-1">
          ✓ Resent ({result.mode})
        </div>
      )}

      {result?.ok && !result.emailed && (
        <div className="notice-warn mt-2 text-[12px]">
          <div>
            <strong>The old link is now dead and the email did NOT send.</strong>{" "}
            Copy and deliver this link now — it is shown once:
            <div className="flex items-stretch gap-2 mt-2">
              <input
                readOnly
                aria-label="Invitation link"
                className="field mono text-[11px] flex-1"
                value={result.tokenUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(result.tokenUrl);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
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
