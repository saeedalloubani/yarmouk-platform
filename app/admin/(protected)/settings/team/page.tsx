// app/admin/(protected)/settings/team/page.tsx
//
// Owner-only team-management surface (self-service Stage 1+2 unblock).
// Lists current admins and provides an invite-read-only-supervisor form.
//
// WHAT THIS PAGE INTENTIONALLY DOES NOT SURFACE:
//   - No role-change UI (no owner→readonly demote, no readonly→owner
//     promote). Inv1 + Inv2 block the dangerous transitions at the DB; the
//     UI just omits the buttons.
//   - No "remove" button on the owner's OWN row (Inv2 enforces; UI omits).
//   - No "create owner" anywhere. There is no input field, no toggle, no
//     "advanced" affordance that would let an owner mint another owner.
//     Owner provisioning is migration-only.
//   - No remove button on readonly admins in v1. Adding it is a follow-up
//     (a removeAdminAction setting status='removed' + auth.admin.deleteUser);
//     the roster shows Removed rows for historical record once shipped.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { listAdmins, type AdminListView } from "@/lib/repos/admins";
import InviteAdminForm from "@/components/InviteAdminForm";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  readonly: "Read-only",
};

const STATUS_CLASS: Record<string, string> = {
  active: "chip-solid bg-brand-50 text-brand-700",
  pending: "chip-solid bg-bgAlt text-muted",
  removed: "chip-solid bg-bgAlt text-muted",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function TeamPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // owner-only

  const all = await listAdmins(supabase);

  // Split into three sections for clarity: active owners, active readonly,
  // removed (history). Order within each section is by email (already
  // applied by the repo for stability).
  const owners = all.filter((a) => a.role === "owner" && a.status !== "removed");
  const readonly = all.filter(
    (a) => a.role === "readonly" && a.status !== "removed"
  );
  const removed = all.filter((a) => a.status === "removed");

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Team
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Invite read-only supervisors. Owner provisioning is reserved to
            the project administrator — see your runbook.
          </p>
        </div>

        {/* Owners */}
        <section className="card p-6 mb-6">
          <h2 className="text-[15px] font-bold text-ink mb-1">Owners</h2>
          <p className="text-[13px] text-muted mb-4">
            Owners have full write access. Cannot be created or removed from
            this page.
          </p>
          <AdminTable
            admins={owners}
            currentAdminId={admin.id}
            emptyHint="No owners. (This should never appear — the DB protects against zero-owner states.)"
          />
        </section>

        {/* Read-only supervisors */}
        <section className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-bold text-ink mb-1">
                Read-only supervisors
              </h2>
              <p className="text-[13px] text-muted">
                See responses, analytics, and the audit log. Cannot send
                invitations or edit questionnaires.
              </p>
            </div>
          </div>
          <AdminTable
            admins={readonly}
            currentAdminId={admin.id}
            emptyHint="No supervisors yet — invite one below."
          />

          <div className="mt-6 pt-6 border-t border-line">
            <h3 className="text-[14px] font-bold text-ink mb-1">
              Invite a supervisor
            </h3>
            <p className="text-[13px] text-muted mb-4">
              Sends a magic-link sign-in email. The recipient becomes a
              read-only supervisor as soon as they click the link.
            </p>
            <InviteAdminForm />
          </div>
        </section>

        {/* Removed (history) */}
        {removed.length > 0 && (
          <section className="card p-6">
            <h2 className="text-[15px] font-bold text-ink mb-1">
              Removed
            </h2>
            <p className="text-[13px] text-muted mb-4">
              Historical record. Their audit-log attribution stays intact.
            </p>
            <AdminTable
              admins={removed}
              currentAdminId={admin.id}
              emptyHint=""
            />
          </section>
        )}
      </div>
    </main>
  );
}

function AdminTable({
  admins,
  currentAdminId,
  emptyHint,
}: {
  admins: AdminListView[];
  currentAdminId: string;
  emptyHint: string;
}) {
  if (admins.length === 0) {
    return <p className="text-[13px] text-muted">{emptyHint}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {admins.map((a) => {
        const isMe = a.id === currentAdminId;
        return (
          <li
            key={a.id}
            className="py-3 flex items-center justify-between gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-ink truncate">
                  {a.name}
                </span>
                {isMe && (
                  <span className="text-[11px] text-muted">(you)</span>
                )}
              </div>
              <div className="text-[12px] text-muted truncate">{a.email}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="chip-solid bg-bgAlt text-muted">
                {ROLE_LABEL[a.role] ?? a.role}
              </span>
              <span
                className={
                  STATUS_CLASS[a.status] ?? "chip-solid bg-bgAlt text-muted"
                }
              >
                {a.status}
              </span>
              <span className="text-[11px] text-muted ms-2">
                {a.status === "removed"
                  ? `removed ${formatDate(a.removedAt)}`
                  : `since ${formatDate(a.activatedAt ?? a.invitedAt)}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
