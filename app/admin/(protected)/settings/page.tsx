// app/admin/(protected)/settings/page.tsx
//
// Admin settings — notification preferences (Session — notification
// preferences). OWNER-ONLY: preferences are a self-service owner surface, so a
// readonly supervisor is redirected away (mirrors the questionnaires owner
// gate; the settings actions owner-gate + RLS np_self_* are the real
// enforcement — this is the UI half). Only the submission-notification section
// exists for now; the other ten preference types are not surfaced yet.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getMySubmissionPrefs } from "@/lib/actions/settings";
import SubmissionPrefsForm from "@/components/SubmissionPrefsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // settings is owner-only

  const prefs = await getMySubmissionPrefs();

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            Settings
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Notification preferences — choose how you&apos;re alerted when a
            response is submitted.
          </p>
        </div>

        <div className="card p-6">
          <h2 className="text-[15px] font-bold text-ink">
            Submission notifications
          </h2>
          <p className="text-[13px] text-muted mt-1 mb-4">
            These apply to you only. Changes save automatically.
          </p>
          <SubmissionPrefsForm
            initialInapp={prefs.submissionInapp}
            initialEmail={prefs.submissionEmail}
          />
        </div>
      </div>
    </main>
  );
}
