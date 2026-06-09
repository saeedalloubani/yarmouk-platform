"use client";

// components/VersionLifecycleButton.tsx
//
// Owner-only lifecycle control on the version detail page. One component,
// two modes — "activate" (draft → active) and "close" (active → closed).
// The page renders the correct mode based on current status; this component
// is unaware of the bigger lifecycle, only of the single transition it owns.
//
// Confirmation is a browser confirm() — same low-ceremony pattern as
// InvitationResendButton. A misclick on "Activate" is recoverable while
// the version has zero responses (DB-side re-draft is allowed by the
// tg_versions_no_unfreeze_with_responses trigger), but Sura should still
// be deliberate — the confirm text names exactly what's about to happen.
//
// After a successful flip, router.refresh() re-renders the (force-dynamic)
// Server Component page; the page's status-conditional logic then shows
// the next button (or no button for the terminal 'closed' state). No
// revalidatePath needed — the page never caches.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activateVersionAction,
  closeVersionAction,
} from "@/lib/actions/questionnaires";

type Mode = "activate" | "close";

type Props = {
  versionId: string;
  mode: Mode;
  /** Shown in the confirmation dialog so the owner knows exactly what
   *  she's flipping (variant + version number). */
  variantLabel: string;
  versionNumber: number;
};

const COPY: Record<Mode, { button: string; confirm: string }> = {
  activate: {
    button: "Activate version",
    confirm:
      "Activating makes this version LIVE and invitable. Questions will be frozen — no further edits possible while it is active. Continue?",
  },
  close: {
    button: "Close collection",
    confirm:
      "Closing ends collection on this version. Existing invitations stop working; responses already collected stay intact. Continue?",
  },
};

export default function VersionLifecycleButton({
  versionId,
  mode,
  variantLabel,
  versionNumber,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (pending) return;
    const ok = window.confirm(
      `${variantLabel} v${versionNumber}\n\n${COPY[mode].confirm}`
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res =
        mode === "activate"
          ? await activateVersionAction(versionId)
          : await closeVersionAction(versionId);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(messageFor(mode, res.error));
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={
          (mode === "activate" ? "btn-primary" : "btn-secondary") +
          " text-[13px] disabled:opacity-40"
        }
      >
        {pending
          ? mode === "activate"
            ? "Activating…"
            : "Closing…"
          : COPY[mode].button}
      </button>
      {error && (
        <span className="text-[12px] text-danger max-w-[260px] text-right">
          {error}
        </span>
      )}
    </div>
  );
}

function messageFor(mode: Mode, err: string): string {
  if (err === "forbidden") return "Owner-only action.";
  if (err === "not_found")
    return "Version not found. Refresh and try again.";
  if (mode === "activate" && err === "not_draft")
    return "This version is no longer a draft. Refresh.";
  if (mode === "activate" && err === "no_questions")
    return "Cannot activate an empty questionnaire — add at least one question first.";
  if (mode === "activate" && err === "variant_already_active")
    return "This variant already has an active version. Close it first.";
  if (mode === "close" && err === "not_active")
    return "This version is not active. Refresh.";
  return "Something went wrong. Try again.";
}
