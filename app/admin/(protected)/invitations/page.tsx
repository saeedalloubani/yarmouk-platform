// app/admin/(protected)/invitations/page.tsx
//
// Invitations list — visible to all admins (3b-i). Reads via the existing
// repo (owner → base, readonly → invitations_redacted); token_hash never
// surfaces. Renders NON-PII columns only (ref_code is the working
// identifier, D5); decrypted recipient name/email is deferred to a future
// detail view. The "New invitation" action is owner-only.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listInvitations, categoryLabel } from "@/lib/repos/invitations";
import InvitationResendButton from "@/components/InvitationResendButton";
import InvitationRevokeButton from "@/components/InvitationRevokeButton";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function InvitationsPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guards

  const invitations = await listInvitations(supabase);
  const isOwner = admin.role === "owner";

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
                  // Terminal states (submitted = respondent finalised;
                  // revoked = owner killed). Neither Resend nor Revoke
                  // applies — the action would reject anyway, but
                  // hiding the controls keeps the UI honest. We rely on
                  // inv.status here; in the rare edge where the
                  // invitation hasn't caught up to a submitted response
                  // (the resend code reads responses as the source of
                  // truth for that reason), the action's own
                  // "already_submitted" check is the backstop.
                  const isTerminal =
                    inv.status === "submitted" || inv.status === "revoked";
                  // Revoked chip uses the danger tokens; everything else
                  // keeps the brand-50 chip. Submitted stays brand for
                  // now (it's a success-terminal); change if Sura wants
                  // a distinct treatment.
                  const chipClass =
                    inv.status === "revoked"
                      ? "chip-solid bg-dangerLight text-danger"
                      : "chip-solid bg-brand-50 text-brand-700";
                  return (
                  <tr key={inv.id} className="border-t border-line">
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
                    </td>
                    <td className="px-4 py-2.5 mono">
                      {inv.useCount}/{inv.maxUses}
                    </td>
                    <td className="px-4 py-2.5">{fmtDate(inv.expiresAt)}</td>
                    <td className="px-4 py-2.5">{fmtDate(inv.createdAt)}</td>
                    {isOwner && (
                      <td className="px-4 py-2.5 align-top">
                        {/* Hide both controls on terminal rows. Render
                            nothing rather than a disabled stub — cleaner
                            than dimmed UI for a row that needs no
                            further owner action. */}
                        {!isTerminal && (
                          <div className="flex items-start gap-3">
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
