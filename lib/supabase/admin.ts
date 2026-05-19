// lib/supabase/admin.ts
//
// SERVICE-ROLE Supabase client. Bypasses RLS. NEVER import from a
// "use client" file — the service-role key would leak to the browser.
//
// Use this only for:
//   1. /api/public/* route handlers that act on behalf of anonymous
//      respondents AFTER validating their invitation token (via the
//      `validate_invitation_token` SQL function).
//   2. Background jobs (cron, scheduled backups, notification fan-out).
//   3. One-off migration / seed scripts run from Node.
//
// Throws on import in the browser as defence against accidental usage.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts is server-only. Import lib/supabase/client.ts " +
      "from client components instead."
  );
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
