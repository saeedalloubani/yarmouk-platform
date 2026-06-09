// app/admin/(protected)/invitations/new/page.tsx
//
// Create-invitation page — OWNER ONLY (3b-i). The (protected) layout
// already guarantees an active admin; this asserts owner specifically and
// redirects a readonly admin back to the list (which they may view). The
// create Server Action re-checks owner server-side too (defense in depth +
// RLS backstop) — this redirect is just so readonly admins never see the
// form.
//
// Loads the active questionnaire versions for the form's version select.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { variantLabel, variantSortIndex } from "@/lib/repos/questionnaires";
import InvitationCreateForm from "@/components/InvitationCreateForm";

export const dynamic = "force-dynamic";

export default async function NewInvitationPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin/invitations");

  const { data: versions, error } = await supabase
    .from("questionnaire_versions")
    .select("id, variant, version_number, type")
    .eq("status", "active");
  if (error) console.error("[invitations/new] versions load failed", error);

  const versionOptions = (versions ?? [])
    .slice()
    .sort(
      (a, b) =>
        variantSortIndex(a.variant) - variantSortIndex(b.variant) ||
        a.version_number - b.version_number
    )
    .map((v) => ({
      id: v.id,
      label: `${variantLabel(v.variant)} · v${v.version_number}`,
    }));

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <div className="eyebrow mb-1">Admin</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              New invitation
            </h1>
          </div>
          {/* D97 — entry point to the bulk-invite flow (additive; the single
              form below is unchanged). */}
          <Link
            href="/admin/invitations/import"
            className="btn-ghost text-[13px] whitespace-nowrap"
          >
            Bulk import →
          </Link>
        </div>
        <InvitationCreateForm versions={versionOptions} />
      </div>
    </main>
  );
}
