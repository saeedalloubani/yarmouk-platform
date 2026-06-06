// app/admin/(protected)/invitations/page.tsx
//
// Invitations list — visible to all admins (3b-i). Reads via the existing
// repo (owner → base, readonly → invitations_redacted); token_hash never
// surfaces. Renders NON-PII columns only (ref_code is the working
// identifier, D5); decrypted recipient name/email is deferred to a future
// detail view. The "New invitation" action is owner-only.
//
// D79 Feature 3 — owner-only "Send reminder" button alongside the
// existing "Resend" button on non-terminal rows. Coexistence (FLAG B):
// Resend = aggressive (rotates credentials), Send reminder = lighter
// nudge (reuses existing link). The SendReminderButton is a server
// component with a native onsubmit confirm() (Path Z LOCKED).
//
// D79 Feature 3 — flash banner from the manual-reminder POST redirect.
// The route handler 303-redirects back to the Referer with ?reminder=
// sent|failed&ref=…&reason=…&wait=…. We surface the banner inline; it
// dismisses on next navigation (URL-param-driven, no client JS).
//
// D79 Feature 4 — per-row email preview via a native <details> expander
// (reuses the .expandable-summary pattern shared with /admin/security).
// Decrypts recipient name + token + access code server-side (owner-only)
// and renders the reminder1 template body byte-identical to what cron
// or the manual button would send. NEVER sends.

import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInvitations, categoryLabel } from "@/lib/repos/invitations";
import InvitationResendButton from "@/components/InvitationResendButton";
import InvitationRevokeButton from "@/components/InvitationRevokeButton";
import SendReminderButton from "@/components/SendReminderButton";
import { renderReminderPreview, type EmailPreview } from "@/lib/email/preview";
import { chipClassFor } from "@/lib/funnel-stages";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Flash-banner shape (mirrors /admin/(protected)/page.tsx). */
type ReminderFlash =
  | { kind: "sent"; ref: string }
  | { kind: "failed"; ref: string; reason: string; waitMin: string | null }
  | null;

function parseFlash(sp: {
  reminder?: string;
  ref?: string;
  reason?: string;
  wait?: string;
}): ReminderFlash {
  if (sp.reminder === "sent" && sp.ref) {
    return { kind: "sent", ref: sp.ref };
  }
  if (sp.reminder === "failed" && sp.ref) {
    return {
      kind: "failed",
      ref: sp.ref,
      reason: sp.reason ?? "unknown",
      waitMin: sp.wait ?? null,
    };
  }
  return null;
}

function flashFailureMessage(
  ref: string,
  reason: string,
  waitMin: string | null
): string {
  switch (reason) {
    case "rate_limited":
      return waitMin
        ? `Reminder cooldown active for ${ref}. Please wait ${waitMin} minute(s) before retrying.`
        : `Reminder cooldown active for ${ref}.`;
    case "send":
      return `Email delivery failed for ${ref}. Check Resend dashboard / audit log.`;
    case "decrypt":
      return `Could not decrypt recipient data for ${ref}. See RUNBOOK Vault key DR.`;
    case "config":
      return `Server misconfigured (RESEND_API_KEY or NEXT_PUBLIC_SITE_URL). See RUNBOOK.`;
    case "not_found":
      return `Invitation not found (${ref}).`;
    case "ineligible":
      return `${ref} is in a terminal or expired state — cannot send reminder. Resend instead.`;
    case "invalid_id":
      return `Invalid invitation id.`;
    default:
      return `Could not send reminder to ${ref}.`;
  }
}

export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    reminder?: string;
    ref?: string;
    reason?: string;
    wait?: string;
  }>;
}) {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  const sp = await searchParams;
  const flash = parseFlash(sp);
  const invitations = await listInvitations(supabase);
  const isOwner = admin.role === "owner";

  // D79 Feature 4 — owner-only previews. The repo's Invitation type
  // intentionally doesn't surface token_plaintext_encrypted /
  // access_code_encrypted (they're owner-only forensic data, not display
  // data). We pull them in a single batched SELECT against the base
  // table for previewable rows, then Promise.all the per-row preview
  // renders (each render does its own 3 decrypts in parallel).
  //
  // At pilot scale (~7 rows × 3 decrypts) this lands in ~300-500ms; at
  // main-study scale (~150 rows × 3 = 450 RPCs) ~1-1.5s. If that grows
  // uncomfortable we'd flip to lazy on-expand via Suspense, but the
  // no-JS posture for D79 keeps everything eager.
  const previewMap = new Map<string, EmailPreview>();
  if (isOwner) {
    const previewable = invitations.filter(
      (inv) =>
        inv.status !== "submitted" &&
        inv.status !== "revoked" &&
        inv.status !== "expired"
    );
    const previewableIds = previewable.map((i) => i.id);
    if (previewableIds.length > 0) {
      // Batch query: one base-table SELECT pulls all the cipher columns
      // we need for the previewable subset. RLS on the base table
      // restricts to owner — already gated above by isOwner check.
      const { data: cipherRows, error: cipherErr } = await supabase
        .from("invitations")
        .select(
          "id, recipient_name_encrypted, token_plaintext_encrypted, access_code_encrypted"
        )
        .in("id", previewableIds);
      if (!cipherErr && cipherRows) {
        const cipherById = new Map(cipherRows.map((c) => [c.id, c]));
        const previews = await Promise.all(
          previewable.map((inv) => {
            const c = cipherById.get(inv.id);
            if (!c) return Promise.resolve(null);
            return renderReminderPreview(supabase, {
              id: inv.id,
              refCode: inv.refCode,
              preferredLanguage: inv.preferredLanguage,
              expiresAt: inv.expiresAt,
              recipientNameEncrypted: c.recipient_name_encrypted,
              tokenPlaintextEncrypted: c.token_plaintext_encrypted,
              accessCodeEncrypted: c.access_code_encrypted,
            }).catch(() => null);
          })
        );
        for (let i = 0; i < previewable.length; i++) {
          const p = previews[i];
          if (p) previewMap.set(previewable[i].id, p);
        }
      }
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="eyebrow mb-1">Admin</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              Invitations
            </h1>
            <p className="text-[13px] text-muted mt-1">
              {invitations.length} total · signed in as {admin.name} ({admin.role})
            </p>
          </div>
          {isOwner && (
            <Link href="/admin/invitations/new" className="btn-primary">
              + New invitation
            </Link>
          )}
        </div>

        {/* D79 Feature 3 — flash banner from POST redirect. */}
        {flash?.kind === "sent" && (
          <div className="notice-success mb-5 text-[13px]">
            ✓ Reminder sent to <span className="mono">{flash.ref}</span>.
          </div>
        )}
        {flash?.kind === "failed" && (
          <div className="notice-warn mb-5 text-[13px]">
            {flashFailureMessage(flash.ref, flash.reason, flash.waitMin)}
          </div>
        )}

        {invitations.length === 0 ? (
          <div className="card p-8 text-center text-[14px] text-muted">
            No invitations yet.
            {isOwner && " Use “+ New invitation” to create the first one."}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-bgAlt text-muted">
                <tr className="text-start">
                  <th className="text-start font-semibold px-4 py-2.5">Ref</th>
                  <th className="text-start font-semibold px-4 py-2.5">Category</th>
                  <th className="text-start font-semibold px-4 py-2.5">Nationality</th>
                  <th className="text-start font-semibold px-4 py-2.5">Status</th>
                  <th className="text-start font-semibold px-4 py-2.5">Uses</th>
                  <th className="text-start font-semibold px-4 py-2.5">Expires</th>
                  <th className="text-start font-semibold px-4 py-2.5">Created</th>
                  {isOwner && (
                    <th className="text-start font-semibold px-4 py-2.5">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const isTerminal =
                    inv.status === "submitted" || inv.status === "revoked";
                  // D81 Item 1 — chip palette pulled from the shared
                  // 5-stage map so the status chip color reads
                  // consistently with the funnel strip + stalled-table
                  // chip on /admin. Covers all six invitation statuses
                  // (sent / opened / started / submitted / revoked /
                  // expired) without per-call ternary tangle.
                  const chipClass = `chip-solid ${chipClassFor(inv.status)}`;
                  const preview = previewMap.get(inv.id);
                  return (
                    <Fragment key={inv.id}>
                      <tr className="border-t border-line">
                        <td className="px-4 py-2.5">
                          <span className="mono font-semibold text-brand-700">
                            {inv.refCode}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{categoryLabel(inv.category)}</td>
                        <td className="px-4 py-2.5 capitalize">
                          {inv.nationality ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={chipClass}>{inv.status}</span>
                          {inv.lastSendFailedAt && (
                            <span
                              className="chip-solid bg-warnLight text-warn ms-2"
                              title="Last send attempt failed — see audit log for details"
                            >
                              send failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 mono">
                          {inv.useCount}/{inv.maxUses}
                        </td>
                        <td className="px-4 py-2.5">{fmtDate(inv.expiresAt)}</td>
                        <td className="px-4 py-2.5">{fmtDate(inv.createdAt)}</td>
                        {isOwner && (
                          <td className="px-4 py-2.5 align-top">
                            {!isTerminal && (
                              <div className="flex items-start gap-3 flex-wrap">
                                <SendReminderButton
                                  invitationId={inv.id}
                                  refCode={inv.refCode}
                                />
                                <InvitationResendButton
                                  invitationId={inv.id}
                                  refCode={inv.refCode}
                                />
                                <InvitationRevokeButton
                                  invitationId={inv.id}
                                  refCode={inv.refCode}
                                />
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* D79 Feature 4 — email preview disclosure. Spans
                          the full table width as a secondary row beneath
                          the data row. Skipped when no preview exists
                          (terminal row, decrypt failure, or not owner). */}
                      {preview && (
                        <tr className="border-t border-line bg-bgSubtle">
                          <td
                            colSpan={isOwner ? 8 : 7}
                            className="px-4 py-3"
                          >
                            <details>
                              <summary className="expandable-summary text-[12px] text-muted cursor-pointer hover:text-ink">
                                Preview email — what {inv.refCode} would
                                receive ({preview.kind})
                              </summary>
                              <div className="mt-3">
                                <p className="text-[11px] text-muted mb-1">
                                  Subject
                                </p>
                                <p className="text-[12px] text-ink mb-3 mono">
                                  {preview.subject}
                                </p>
                                <p className="text-[11px] text-muted mb-1">
                                  Body
                                </p>
                                {/* The rendered HTML comes from our own
                                    template renderer, which escapes user
                                    inputs (refCode, name) and produces a
                                    sanitized fragment. Inline-embedded with
                                    dangerouslySetInnerHTML — same posture as
                                    the audit Details cell (D77). */}
                                <div
                                  className="rounded border border-line bg-white p-2"
                                  dangerouslySetInnerHTML={{
                                    __html: preview.html,
                                  }}
                                />
                              </div>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

