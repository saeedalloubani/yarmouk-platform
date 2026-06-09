"use client";

// components/CreateVersionForm.tsx
//
// D101 — main-variant picker for creating a new draft questionnaire version.
// Each variant shows its current version state; a variant with NO version
// reads as NOTABLE (amber "no version yet"), since that's the abnormal,
// likely-deleted state. Picking a variant that already has a draft is ALLOWED
// but warned (a 2nd draft alongside an active version is a legit revision; for
// the recovery case there's usually no version). On success → straight into
// the new draft's editor (continuous create → author → activate; the D96 guard
// blocks activating it while empty).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVersionAction } from "@/lib/actions/questionnaires";

export type VariantOption = {
  variant: string;
  label: string;
  /** e.g. "no version yet" | "v1 draft" | "v1 active · v2 draft" */
  summary: string;
  hasAny: boolean;
  hasDraft: boolean;
};

export default function CreateVersionForm({
  options,
}: {
  options: VariantOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sel = options.find((o) => o.variant === selected) ?? null;

  function onCreate() {
    if (pending || !selected) return;
    setError(null);
    startTransition(async () => {
      const res = await createVersionAction(selected);
      if (res.ok) {
        router.push(`/admin/questionnaires/${res.versionId}`);
        return;
      }
      setError(messageFor(res.error));
    });
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-semibold text-ink mb-1">
          Choose a variant
        </legend>
        {options.map((o) => {
          const active = o.variant === selected;
          return (
            <label
              key={o.variant}
              className={
                "flex items-center gap-3 card p-3 cursor-pointer " +
                (active ? "ring-2 ring-brand-500" : "")
              }
            >
              <input
                type="radio"
                name="variant"
                value={o.variant}
                checked={active}
                onChange={() => setSelected(o.variant)}
                className="accent-brand-600"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium text-ink">
                  {o.label}
                </span>
                {o.hasAny ? (
                  <span className="block text-[12px] text-muted mono">
                    {o.summary}
                  </span>
                ) : (
                  <span className="block text-[12px] text-amber-700 font-medium">
                    {o.summary} — create one
                  </span>
                )}
              </span>
              {!o.hasAny && (
                <span className="chip-solid bg-amber-50 text-amber-700 text-[11px]">
                  needs attention
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      {sel?.hasDraft && (
        <p className="text-[12px] text-amber-700 max-w-prose">
          {sel.label} already has a draft — you usually don&apos;t need another.
          Creating one adds a higher version number alongside it.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={onCreate}
          disabled={!selected || pending}
          className="btn-primary text-[13px] disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create draft version"}
        </button>
        {error && (
          <p className="text-[13px] text-danger mt-2 max-w-prose">{error}</p>
        )}
      </div>
    </div>
  );
}

function messageFor(err: string): string {
  switch (err) {
    case "forbidden":
      return "Owner-only action.";
    case "invalid_variant":
      return "Pick a main-study variant.";
    case "version_exists":
      return "That version number was just taken — try again.";
    default:
      return "Something went wrong creating the version. Try again.";
  }
}
