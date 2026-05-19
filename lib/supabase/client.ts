// lib/supabase/client.ts
//
// Supabase client for "use client" components. Anon key; all queries
// are subject to RLS.
//
// Most admin mutations should go through Server Actions (server-side).
// Use this client only when you genuinely need browser-side capability:
// realtime subscriptions, file upload progress, etc.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
