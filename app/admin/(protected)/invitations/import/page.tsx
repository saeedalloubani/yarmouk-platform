// app/admin/(protected)/invitations/import/page.tsx
//
// Bulk-invite import page (D97) — OWNER ONLY. Mirrors invitations/new's gate:
// the (protected) layout guarantees an active admin; this asserts owner and
// bounces a readonly admin back to the list. The upload action re-checks owner
// server-side (defense in depth + RLS backstop).
//
// D97 ends at "rows validated + confirmed". No invitations are created and no
// email is sent here — the confirm button is the seam to D98.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import BulkInviteImport from "@/components/BulkInviteImport";

export const dynamic = "force-dynamic";

export default async function BulkImportPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin/invitations");

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <div className="eyebrow mb-1">Admin · Invitations</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              Bulk import
            </h1>
          </div>
          <Link
            href="/admin/invitations/new"
            className="btn-ghost text-[13px]"
          >
            ← Single invitation
          </Link>
        </div>
        <BulkInviteImport />
      </div>
    </main>
  );
}
