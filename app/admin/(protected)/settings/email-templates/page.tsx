// app/admin/(protected)/settings/email-templates/page.tsx
//
// D22 + Stage 2 + D64 — owner-only list page for email templates. Lists
// all five editable templates:
//   - invitation     (bilingual participant invite)
//   - reminder1      (bilingual ~7d auto-nudge)              D64
//   - reminderFinal  (bilingual ~14d final auto-nudge)       D64
//   - admin-invite   (EN-only supervisor magic-link)
//   - submission     (EN-only owner-side "a response was submitted")
//
// The respondent-facing series is grouped first (invitation → reminder1
// → reminderFinal) so Sura can move through the outreach cycle in
// chronological order, then the owner- and supervisor-facing operational
// templates. Mirrors the team page shape (card, list, header).

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import type { TemplateId } from "@/lib/email/templates/types";

export const dynamic = "force-dynamic";

// Declaration order = display order. The respondent-facing outreach
// cycle goes first in chronological order (invitation → 7d reminder →
// 14d final reminder), then the supervisor-facing magic-link, then the
// owner-facing submission notification. D64 — reminder1 + reminderFinal
// inserted between invitation and admin-invite.
const TEMPLATES: TemplateId[] = [
  "invitation",
  "reminder1",
  "reminderFinal",
  "admin-invite",
  "submission",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function EmailTemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin");

  const rows = await Promise.all(
    TEMPLATES.map(async (id) => {
      const stored = await getTemplate(supabase, id);
      const defaults = getDefaults(id);
      return {
        id,
        name: defaults.name,
        description: defaults.description,
        customized: stored !== null,
        updatedAt: stored?.updatedAt ?? null,
      };
    })
  );

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Email templates
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Edit the copy of emails the platform sends. The sign-in button
            and the layout are system-controlled — you change the words,
            we keep the link working.
          </p>
        </div>

        <section className="card p-6">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/admin/settings/email-templates/${r.id}`}
                      className="text-[14px] font-semibold text-brand-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.customized ? (
                      <span className="chip-solid bg-brand-50 text-brand-700">
                        customized
                      </span>
                    ) : (
                      <span className="chip-solid bg-bgAlt text-muted">
                        default
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">
                    {r.description}
                  </div>
                </div>
                <div className="text-[11px] text-muted flex-shrink-0">
                  {r.customized
                    ? `edited ${formatDate(r.updatedAt)}`
                    : "shipping defaults"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
