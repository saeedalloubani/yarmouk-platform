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
import ConsentForm from "@/components/ConsentForm";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const admin = createSupabaseAdminClient();
  if (await consentExistsForResponse(admin, session.responseId)) {
    redirect("/questionnaire");
  }

  const lang = await getLang();
  return <ConsentForm lang={lang} />;
}
