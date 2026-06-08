// components/VariantChip.tsx
//
// D94 — per-row "which study + variant" chip for the Invitations +
// Responses list pages. Renders the variant slug via the canonical
// variantLabel() (the same fn analytics + the question editor use, so the
// label reads identically everywhere: "Pilot · Officials", "Main ·
// Officials (Jordanian)", …).
//
// Pilot vs Main are visually distinguished WITHOUT brand-blue (which owns
// the active-nav pill, D91): main = accent (teal) chip, pilot = neutral
// gray chip. The tier is read from `type` ('pilot' | 'main'), falling
// back to the slug prefix if type is absent.
//
// Pure presentational SERVER component — variantLabel is a pure function
// (no client deps). Null variant (version no longer resolvable) → an
// em-dash, never a crash.

import { variantLabel } from "@/lib/repos/questionnaires";

export default function VariantChip({
  variant,
  type,
}: {
  variant: string | null | undefined;
  type: string | null | undefined;
}) {
  if (!variant) {
    return <span className="text-muted-faint">—</span>;
  }
  const isMain = type === "main" || variant.startsWith("main_");
  const cls = isMain
    ? "bg-accent-50 text-accent-700"
    : "bg-bgAlt text-muted-strong";
  return (
    <span className={`chip-solid ${cls} text-[11px] whitespace-nowrap`}>
      {variantLabel(variant)}
    </span>
  );
}
