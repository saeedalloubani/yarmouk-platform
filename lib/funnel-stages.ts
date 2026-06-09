// lib/funnel-stages.ts
//
// D81 Item 1 — shared funnel-stage palette + mapper. The pilot has three
// surfaces that should render the same stage-derived color so the system
// reads consistently:
//
//   1. /admin pilot dashboard funnel chip strip (5 stages).
//   2. /admin pilot dashboard stalled-invitations table chip ("Never
//      opened" → Opened color, "Started, not submitted" → Started color).
//   3. /admin/invitations status chip column (per inv.status).
//
// One palette here, three importers. If a future task adds a 6th stage
// or rebrands the colors, the rebrand happens once.
//
// Palette decisions (locked at D81 read-first):
//   - Sent → bg-bgAlt text-muted          (gray; passive, just delivered)
//   - Opened → bg-brand-50 text-brand-700 (blue; informational)
//   - Consent granted → bg-amber-100 text-amber-800
//                                         (amber; active commitment)
//   - Started → bg-orange-200 text-orange-900
//                                         (orange; actively working —
//                                          bumped from -100/-800 for
//                                          clearer amber↔orange separation)
//   - Submitted → bg-accent-600 text-white (green; terminal success)
//
// Off-funnel statuses (revoked, expired) carry their own non-stage chips
// — see `OFF_FUNNEL_PALETTE` below. These are NOT funnel stages; they
// surface in invitations.status enum but never count toward the funnel
// numerator (the funnel repo excludes them up front).
//
// Tailwind notes:
//   - amber-100 / amber-800 / orange-200 / orange-900 are default Tailwind
//     tokens — preserved by tailwind.config.ts's `extend` posture.
//   - bg-bgAlt / text-muted / bg-brand-* / bg-accent-* are project tokens
//     defined in tailwind.config.ts.

/** Cumulative funnel stages, low-progress → terminal success. Order matches
 *  the funnel left-to-right reading direction (LTR). The Consent granted
 *  stage was added by D81 between Opened and Started. */
export type FunnelStage =
  | "sent"
  | "opened"
  | "consent_granted"
  | "started"
  | "submitted";

/** Off-funnel statuses. Show up on the invitations list status chip but
 *  never count toward funnel numerators (the repo excludes them before
 *  counting). Kept separate so importers can't accidentally feed them into
 *  stage math.
 *
 *  D98 — 'pending' (bulk-created, not yet emailed) is off-funnel and PRE-send:
 *  it sits BEFORE 'sent', so it must never count as sent/opened/etc. (revoked
 *  + expired are POST/terminal off-funnel; pending is pre-funnel — all three
 *  share the "excluded from stage math" treatment). */
export type OffFunnelStatus = "pending" | "revoked" | "expired";

/** Display label per funnel stage. Title-cased for chip rendering. */
export const STAGE_LABEL: Record<FunnelStage, string> = {
  sent: "Sent",
  opened: "Opened",
  consent_granted: "Consent granted",
  started: "Started",
  submitted: "Submitted",
};

/** Tailwind class strings per funnel stage. Both background + text colors
 *  are bundled so a consumer just spreads `STAGE_PALETTE[stage]` onto
 *  className alongside `chip-solid`. */
export const STAGE_PALETTE: Record<FunnelStage, string> = {
  sent: "bg-bgAlt text-muted",
  opened: "bg-brand-50 text-brand-700",
  consent_granted: "bg-amber-100 text-amber-800",
  started: "bg-orange-200 text-orange-900",
  submitted: "bg-accent-600 text-white",
};

/** Off-funnel chip styling. Revoked = destructive (red); expired = neutral
 *  (gray). Both are terminal labels, not progression signals. */
export const OFF_FUNNEL_PALETTE: Record<OffFunnelStatus, string> = {
  // D98 — pending = queued for sending (amber: waiting, distinct from
  // revoked-danger and the muted sent/expired greys, and not brand-blue).
  pending: "bg-amber-50 text-amber-700",
  revoked: "bg-dangerLight text-danger",
  expired: "bg-bgAlt text-muted",
};

/** Map the canonical `invitations.status` value (D31 enum) to the funnel
 *  stage that best represents it on a chip. The invitation status enum
 *  doesn't include a `consent_granted` value — consent is tracked on
 *  `consent_records.signed_at` — so this mapper only covers the four
 *  invitation-side stages plus the two off-funnel terminals.
 *
 *  Returns null for off-funnel statuses (caller uses OFF_FUNNEL_PALETTE).
 *  The discriminator is exhaustive: TypeScript will widen `status` against
 *  `InvitationStatusValue` from lib/repos/invitations.ts and a never-branch
 *  is the safe default. */
export function stageFor(
  status: string
): { kind: "stage"; stage: FunnelStage } | { kind: "off"; status: OffFunnelStatus } | null {
  switch (status) {
    case "sent":
      return { kind: "stage", stage: "sent" };
    case "opened":
      return { kind: "stage", stage: "opened" };
    case "started":
      return { kind: "stage", stage: "started" };
    case "submitted":
      return { kind: "stage", stage: "submitted" };
    case "pending":
      return { kind: "off", status: "pending" };
    case "revoked":
      return { kind: "off", status: "revoked" };
    case "expired":
      return { kind: "off", status: "expired" };
    default:
      return null;
  }
}

/** Convenience for callers that want a single className string given a raw
 *  status value. Falls back to a neutral chip palette when the status is
 *  unrecognized (defensive; should never trigger in production). */
export function chipClassFor(status: string): string {
  const out = stageFor(status);
  if (!out) return "bg-bgAlt text-muted";
  if (out.kind === "stage") return STAGE_PALETTE[out.stage];
  return OFF_FUNNEL_PALETTE[out.status];
}
