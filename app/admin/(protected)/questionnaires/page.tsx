// app/admin/(protected)/questionnaires/page.tsx
//
// Questionnaire versions list / editor entry point (Session 3 — question
// editor). OWNER-ONLY: the editor builds research-instrument content, so a
// readonly supervisor is redirected away (the actions + the
// questions_draft_only trigger refuse writes regardless — this is the UI
// half). DRAFT versions are openable in the editor; ACTIVE/CLOSED versions
// are shown but marked frozen (D10), not editable.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  listVersionsForEditor,
  getQuestionCounts,
  variantLabel,
} from "@/lib/repos/questionnaires";

export const dynamic = "force-dynamic";

export default async function QuestionnairesPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // editor is owner-only

  const versions = await listVersionsForEditor(supabase);
  const counts = await getQuestionCounts(supabase);

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="eyebrow mb-1">Admin</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              Questionnaires
            </h1>
            <p className="text-[13px] text-muted mt-1 max-w-prose">
              Edit draft questionnaire content. Active and closed versions are
              frozen (D10) — to revise a live questionnaire or restore a deleted
              one, create a new draft version.
            </p>
          </div>
          {/* D101 — create a new main draft version (owner-only page). */}
          <Link
            href="/admin/questionnaires/new"
            className="btn-primary text-[13px] whitespace-nowrap"
          >
            New main version
          </Link>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-bgAlt text-muted">
              <tr>
                <th className="text-start font-semibold px-4 py-2.5">Variant</th>
                <th className="text-start font-semibold px-4 py-2.5">Type</th>
                <th className="text-start font-semibold px-4 py-2.5">Version</th>
                <th className="text-start font-semibold px-4 py-2.5">Status</th>
                <th className="text-start font-semibold px-4 py-2.5">Questions</th>
                <th className="text-end font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isDraft = v.status === "draft";
                return (
                  <tr key={v.id} className="border-t border-line hover:bg-bgAlt/50">
                    <td className="px-4 py-2.5 font-medium text-ink">{variantLabel(v.variant)}</td>
                    <td className="px-4 py-2.5 capitalize">{v.type}</td>
                    <td className="px-4 py-2.5 mono">v{v.versionNumber}</td>
                    <td className="px-4 py-2.5">
                      {isDraft ? (
                        <span className="chip-solid bg-brand-50 text-brand-700">draft</span>
                      ) : v.status === "active" ? (
                        <span className="chip-solid bg-warnLight text-warn">active — frozen</span>
                      ) : (
                        <span className="chip-solid bg-bgAlt text-muted">closed</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 mono">{counts.get(v.id) ?? 0}</td>
                    <td className="px-4 py-2.5 text-end">
                      <Link
                        href={`/admin/questionnaires/${v.id}`}
                        className="text-brand-700 font-semibold hover:underline"
                      >
                        {isDraft ? "Edit" : "View"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
