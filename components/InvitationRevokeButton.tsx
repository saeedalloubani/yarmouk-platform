"use client";

// components/InvitationRevokeButton.tsx
//
// Per-row revoke control (owner-only; rendered only when isOwner AND
// the row is not in a terminal state — see page-level visibility gating
// in app/admin/(protected)/invitations/page.tsx).
//
// Calls revokeInvitationAction, which performs the three-op terminal
// kill: rotate token_hash (link dies) + set status='revoked' (terminal
// label) + lock any non-submitted response (kicks active sessions; saved
// answers are RETAINED, not deleted).
//
// CONFIRM UX — two-step, honest wording:
//   1. First confirm (generic): "Revoke X? The magic link will stop
//      working." Single click → no in-progress check has happened yet
//      from the UI side; the action's first call returns the gate.
//   2. If the action returns error:"in_progress", we show a SECOND
//      window.confirm with the honest in-progress wording (saved answers
//      are retained, respondent can't continue, link dies) and re-call
//      with confirmHardRevoke=true.
//
// This matches the resend pattern (window.confirm two-step) — no modal.
// Modal can come later if Sura asks for stronger friction on the
// hard-revoke case; the current friction is "type… read… click again"
// which is right for the destructive-but-recoverable nature of revoke
// (you can always create a new invitation).
//
// ERROR HANDLING — all RevokeInvitationResult error variants are
// surfaced inline beside the button:
//   - "in_progress": replaced by the second confirm flow (above).
//   - "already_revoked": stale UI tab — self-corrects via
//     router.refresh() (the inline note "Already revoked — refreshing…"
//     bridges the brief gap before the row re-renders into its
//     terminal state and unmounts these controls).
//   - "already_submitted": invitation has been answered — revoke is the
//     wrong tool here (that's "withdraw response", not built).
//   - "not_found": invitation row missing.
//   - "forbidden": readonly admin reached the action (also blocked at
//     the page-level isOwner gate; this is the belt-and-suspenders
//     line).
//   - "server": transient — try again.
//
// On success: a short ✓ indicator. The row will re-render with
// status='revoked' once the page is refreshed (we don't auto-refresh
// here; the user can navigate away or reload — same pattern as
// resend's success path, which also doesn't auto-refresh).
//
// D81 Item 4 — icon-only trigger button. Text label ("Revoke" /
// "Revoking…") replaced by an inline Trash2 SVG (lucide geometry,
// hand-coded, no new dep). Destructive intent signalled by text-danger
// on the icon itself; aria-label + title carry the action verb so the
// red color isn't the sole semantic carrier (color-blindness safe). The
// two-step confirm flow + success / error chrome below are UNCHANGED.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  revokeInvitationAction,
  type RevokeInvitationResult,
} from "@/lib/actions/invitations";

// D81 Item 4 — Trash2 icon (lucide geometry, hand-coded inline).
// stroke-width=2 matches Bell + RotateCw for consistent visual weight.
function Trash2Icon() {
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
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export default function InvitationRevokeButton({
  invitationId,
  refCode,
}: {
  invitationId: string;
  refCode: string;
}) {
  const [result, setResult] = useState<RevokeInvitationResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onRevoke() {
    if (pending) return;

    // Step 1: generic confirm. Same friction level as resend's confirm —
    // a single click after a typed warning is enough for the
    // no-response case. The harder confirmation only fires if the
    // action tells us someone is mid-flow.
    const ok = window.confirm(
      `Revoke ${refCode}? The magic link will stop working immediately. ` +
        `This is permanent — to re-invite, create a fresh invitation.`
    );
    if (!ok) return;

    setResult(null);
    startTransition(async () => {
      const r = await revokeInvitationAction(invitationId);

      // Block-then-confirm: action says someone is mid-flow. Show the
      // honest second confirmation, then re-call with the override
      // flag. The wording matches reality (is_locked retains the saved
      // answers and only blocks future writes; owner can still read
      // them) — verified against lib/cookies.ts getSession +
      // lib/actions/answers.ts saveAnswer.
      if (!r.ok && r.error === "in_progress") {
        const okHard = window.confirm(
          `${refCode} has started answering. Revoking will lock them ` +
            `out of continuing — their saved answers are retained and ` +
            `visible to you, but they cannot add more or submit. The ` +
            `magic link will also stop working. Continue?`
        );
        if (!okHard) {
          // Surface as a soft cancellation, not an error.
          setResult(null);
          return;
        }
        const r2 = await revokeInvitationAction(invitationId, {
          confirmHardRevoke: true,
        });
        setResult(r2);
        return;
      }

      // already_revoked is a STALENESS signal — the UI is showing this
      // row as revocable, but the action proves otherwise. Self-correct:
      // set the brief inline note (so the jump isn't silent) and call
      // router.refresh() to re-fetch the Server Component, which will
      // re-render this row with status='revoked' → isTerminal=true →
      // both Resend and Revoke are unmounted by the parent page. The
      // inline note disappears with the unmount. This is the one
      // already-known stale-state branch where staying put would be
      // misleading; resend has no equivalent (a successful resend
      // leaves the row in a valid actionable state, so manual refresh
      // is fine there).
      if (!r.ok && r.error === "already_revoked") {
        setResult(r);
        router.refresh();
        return;
      }

      setResult(r);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={pending}
        aria-label={`Revoke ${refCode} — kill the magic link`}
        title={pending ? "Revoking…" : "Revoke (kills the link permanently)"}
        className="btn-ghost inline-flex items-center justify-center w-8 h-8 p-0 text-danger disabled:opacity-40"
      >
        <Trash2Icon />
      </button>

      {result?.ok && (
        <div className="text-[12px] text-danger mt-1">
          ✓ Revoked
          {result.hadInProgressResponse && " · session locked"}
        </div>
      )}

      {result && !result.ok && (
        <div className="text-[12px] text-danger mt-1">
          {result.error === "already_revoked" && "Already revoked — refreshing…"}
          {result.error === "already_submitted" &&
            "Already answered — revoke does not apply to submitted invitations."}
          {result.error === "not_found" && "Invitation not found."}
          {result.error === "forbidden" && "Owner only."}
          {result.error === "server" && "Something went wrong — try again."}
          {/* "in_progress" is handled in onRevoke and never reaches here. */}
        </div>
      )}
    </div>
  );
}
