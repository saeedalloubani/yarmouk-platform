// app/admin/(protected)/page.tsx
//
// Auth-proof landing for /admin (Session 3a). NOT the real dashboard —
// just enough to prove auth + role resolution work end to end: it renders
// the signed-in admin's name + role and offers sign-out. The real overview
// dashboard arrives in a later Session 3 sub-session.
//
// The (protected) layout has already guaranteed an active admin; we re-fetch
// here for display (a second cheap RPC) and null-guard defensively in case
// the admin was removed between layout and page render.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminLandingPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login"); // defensive; layout already guarded

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="eyebrow mb-3">Admin</div>
        <h1 className="text-[22px] font-semibold text-ink mb-2">
          Signed in as {admin.name}
        </h1>
        <p className="text-[14px] text-muted mb-8">
          Role:{" "}
          <span className="chip-solid bg-brand-50 text-brand-700 mono">
            {admin.role}
          </span>
        </p>
        <p className="text-[13px] text-muted-faint mb-6">
          Admin authentication is working. The dashboard arrives in a later
          session.
        </p>

        <nav className="flex flex-wrap items-center justify-center gap-2 mb-8">
          <Link href="/admin/responses" className="btn-secondary text-[13px]">
            Responses
          </Link>
          <Link href="/admin/invitations" className="btn-secondary text-[13px]">
            Invitations
          </Link>
          {admin.role === "owner" && (
            <Link href="/admin/questionnaires" className="btn-secondary text-[13px]">
              Questionnaires
            </Link>
          )}
        </nav>

        <form action={signOut}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
