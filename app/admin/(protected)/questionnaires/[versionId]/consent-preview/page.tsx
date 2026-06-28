// app/admin/(protected)/questionnaires/[versionId]/consent-preview/page.tsx
//
// D105a — OWNER-ONLY, ZERO-WRITE preview of the consent screen as a respondent
// of this version's TYPE would see it: a main version → the approved JUST/WDC
// main consent (D105); a pilot version → the original pilot consent. Mirrors
// the questionnaire "Preview as respondent" route (owner-gated, no session, no
// response, no token). Renders the real ConsentForm in `preview` mode — the
// Sign button is inert, so NOTHING is written (no consent_records, no response).

import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getVersion, variantLabel } from "@/lib/repos/questionnaires";
import ConsentPreviewFrame from "@/components/ConsentPreviewFrame";

export const dynamic = "force-dynamic";

export default async function ConsentPreviewPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin"); // preview is owner-only

  const version = await getVersion(supabase, versionId);
  if (!version) notFound();

  // The consent COPY follows the version type: main → approved main consent;
  // anything else → pilot consent. Same resolution the real /consent page uses.
  const consentType = version.type === "main" ? "main" : "pilot";

  return (
    <ConsentPreviewFrame
      type={consentType}
      versionLabel={variantLabel(version.variant)}
      versionNumber={version.versionNumber}
      status={version.status}
      editHref={`/admin/questionnaires/${versionId}`}
    />
  );
}
