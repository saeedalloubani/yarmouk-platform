"use client";

// components/WithdrawResponseButton.tsx
//
// Owner-only Withdraw control on the response detail page (rendered
// only when isOwner AND response.submittedAt is set AND
// response.status === 'active' — see page-level visibility gating in
// app/admin/(protected)/responses/[id]/page.tsx).
//
// Calls withdrawResponseAction (D63), which soft-deletes the response:
// atomic UPDATE setting status='withdrawn' + withdrawn_at=NOW(), audit
// at 'alert' severity (first-use of the tier — reserved for
// data-altering admin actions on submitted research data). The
// consent_records row is RETAINED as cryptographic proof; the response
// row is excluded from exports/dashboards/feedback by scattered
// `.eq("status", "active")` filters at every aggregating read site.
//
// CONFIRM UX — single window.confirm (NO second-step like revoke). The
// not_submitted edge case is caught upstream by the action and shown as
// an inline error; the confirm flow itself has only one decision
// surface, matching the "single ethics action" framing.
//
// ERROR HANDLING — all WithdrawResponseResult error variants surface
// inline beside the button:
//   - "not_submitted": explicit guidance pointing Sura to the right
//     tool (revoke the invitation, which locks the session and retains
//     the draft). This is the "wrong-tool" case; Sura should never
//     have to guess what to do next.
//   - "already_withdrawn": stale UI tab — self-corrects via
//     router.refresh() (matches revoke's already_revoked pattern).
//     Brief inline note bridges the gap before the page re-renders
//     into its terminal state.
//   - "not_found": defensive — response row missing.
//   - "forbidden": readonly admin reached the action (also blocked at
//     the page-level isOwner gate; this is the belt-and-suspenders
//     line).
//   - "server": transient — try again.
//
// On success: short "✓ Withdrawn at <local timestamp>" indicator AND
// router.refresh() — this DIVERGES from revoke's "✓ Revoked" stay-put
// pattern on purpose. Revoke is on the list page (row stays in place
// while the user keeps scanning the list); withdraw is on the detail
// page (the page itself materially changes state — the badge appears,
// the Withdrawal card flips to its withdrawn-state view, this button
// unmounts). Without refresh, the success line says "✓ Withdrawn
// at..." but the rest of the page would lie about state until the user
// manually reloads. The success line renders briefly during the
// transition, then the page re-renders into its withdrawn state and
// the line unmounts with the button. Clean handoff.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  withdrawResponseAction,
  type WithdrawResponseResult,
} from "@/lib/actions/responses";

export default function WithdrawResponseButton({
  responseId,
  refCode,
}: {
  responseId: string;
  refCode: string;
}) {
  const [result, setResult] = useState<WithdrawResponseResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onWithdraw() {
    if (pending) return;

    // Single confirm — honest wording covering soft-delete semantics,
    // audit severity, and irreversibility-via-UI. No second-step path
    // (the not_submitted gate fires inside the action and surfaces as
    // an inline error, not a confirm-again loop).
    const ok = window.confirm(
      `Withdraw response ${refCode}? The response is retained as a record ` +
        `of the withdrawal (consent row preserved for audit) but excluded ` +
        `from exports, ATLAS.ti, and analytics. This action is logged at ` +
        `alert severity and cannot be reversed via the UI. Continue?`
    );
    if (!ok) return;

    setResult(null);
    startTransition(async () => {
      const r = await withdrawResponseAction(responseId);

      // already_withdrawn is a STALENESS signal — the UI is showing
      // this response as withdrawable, but the action proves otherwise.
      // Self-correct: set the brief inline note (so the jump isn't
      // silent) and call router.refresh() to re-fetch the Server
      // Component, which re-renders the page with status='withdrawn'
      // → button unmounted, Withdrawal card switches to the
      // withdrawn-state view. The inline note disappears with the
      // unmount. Same pattern as InvitationRevokeButton's
      // already_revoked branch.
      if (!r.ok && r.error === "already_withdrawn") {
        setResult(r);
        router.refresh();
        return;
      }

      setResult(r);

      // On success, refresh the detail page so the rest of the UI
      // (header badge, Withdrawal card's status-aware render, hidden
      // button) reflects the new state. See file header for the
      // diverge-from-revoke rationale (detail-page vs list-page).
      if (r.ok) {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onWithdraw}
        disabled={pending}
        className="btn-ghost text-[12px] text-danger disabled:opacity-40"
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>

      {result?.ok && (
        <div className="text-[12px] text-danger mt-1">
          ✓ Withdrawn at {new Date(result.withdrawnAt).toLocaleString()}
        </div>
      )}

      {result && !result.ok && (
        <div className="text-[12px] text-danger mt-1">
          {result.error === "not_submitted" &&
            "Cannot withdraw an in-progress response. To stop a participant " +
              "who has started but not submitted, revoke the invitation " +
              "instead — that locks their session and retains the draft."}
          {result.error === "already_withdrawn" && "Already withdrawn — refreshing…"}
          {result.error === "not_found" && "Response not found."}
          {result.error === "forbidden" && "Owner only."}
          {result.error === "server" && "Something went wrong — try again."}
        </div>
      )}
    </div>
  );
}
