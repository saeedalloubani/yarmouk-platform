// app/(public)/consent/page.tsx
//
// Consent screen (Server Component). Guards:
//   - no session → redirect to /
//   - consent already exists for this response → redirect to
//     /questionnaire (can't re-consent; response_id is UNIQUE)
// Then renders the client ConsentForm in the resolved language.

import { redirect } from "next/navigation";
import { getSession, getLang } from "@/lib/cookies";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consentExistsForResponse } from "@/lib/repos/consent";
import { getVersion } from "@/lib/repos/questionnaires";
import ConsentForm from "@/components/ConsentForm";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const admin = createSupabaseAdminClient();
  if (await consentExistsForResponse(admin, session.responseId)) {
    redirect("/questionnaire");
  }

  // D105 — the consent COPY is type-specific: main shows the approved JUST/WDC
  // IRB form; pilot keeps its original wording. Resolve the version type
  // server-side from the session (never the client). Defaults to the pilot
  // copy if the version can't be resolved (safe, unchanged behavior).
  const version = await getVersion(admin, session.questionnaireVersionId);
  const consentType = version?.type === "main" ? "main" : "pilot";

  const lang = await getLang();
  return <ConsentForm lang={lang} type={consentType} />;
}
