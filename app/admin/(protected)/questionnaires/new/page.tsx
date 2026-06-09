// app/admin/(protected)/questionnaires/new/page.tsx
//
// D101 — create a new MAIN draft questionnaire version. OWNER-ONLY (mirrors
// the questionnaires list + /admin/invitations/new gates). Closes the gap
// where a deleted seed draft was recoverable only via manual SQL.
//
// Doubles as a health check: each of the 5 main variants shows its current
// version state, and a variant with NO version reads as NOTABLE (amber,
// sorted first) — that's the abnormal state that signals a deleted version.
// Glance here and you can see all 5 have a version vs one missing.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  listVersionsForEditor,
  variantLabel,
  variantSortIndex,
} from "@/lib/repos/questionnaires";
import { Constants } from "@/lib/supabase/database.types";
import CreateVersionForm, {
  type VariantOption,
} from "@/components/CreateVersionForm";

export const dynamic = "force-dynamic";

export default async function NewVersionPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // create is owner-only

  const versions = await listVersionsForEditor(supabase);

  // The 5 main variants, derived from the canonical enum (main-only scope).
  const mainVariants = Constants.public.Enums.questionnaire_variant.filter((v) =>
    v.startsWith("main_")
  );

  const options: VariantOption[] = mainVariants
    .map((variant) => {
      const vs = versions
        .filter((v) => v.variant === variant)
        .sort((a, b) => a.versionNumber - b.versionNumber);
      const summary =
        vs.length === 0
          ? "no version yet"
          : vs.map((v) => `v${v.versionNumber} ${v.status}`).join(" · ");
      return {
        variant,
        label: variantLabel(variant),
        summary,
        hasAny: vs.length > 0,
        hasDraft: vs.some((v) => v.status === "draft"),
      };
    })
    // Missing-first (the "needs attention" state), then canonical order.
    .sort(
      (a, b) =>
        Number(a.hasAny) - Number(b.hasAny) ||
        variantSortIndex(a.variant) - variantSortIndex(b.variant)
    );

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <div className="eyebrow mb-1">Admin · Questionnaires</div>
            <h1 className="text-[24px] font-bold text-ink tracking-tight">
              New main version
            </h1>
          </div>
          <Link href="/admin/questionnaires" className="btn-ghost text-[13px]">
            ← Questionnaires
          </Link>
        </div>
        <p className="text-[13px] text-muted mb-6 max-w-prose">
          Create a fresh <strong>draft</strong> version for a main-study
          variant — to author a brand-new questionnaire or revise a live one.
          The draft starts empty; add questions in the editor, then activate it
          when ready. A variant showing{" "}
          <span className="text-amber-700">“no version yet”</span> has none —
          create one to restore it.
        </p>
        <CreateVersionForm options={options} />
      </div>
    </main>
  );
}
