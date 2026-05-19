// lib/supabase/server.ts
//
// Supabase client for Server Components, Server Actions, and admin Route
// Handlers. Reads/writes auth cookies via next/headers so admin sessions
// persist across requests.
//
// Use this for any authenticated server-side work. For service-role calls
// (anonymous-respondent route handlers, migrations, cron jobs), use
// lib/supabase/admin.ts instead.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Calling cookies().set() from a Server Component throws —
            // that's expected. Middleware will refresh the session on
            // the next request and the cookies will be set there.
          }
        },
      },
    }
  );
}
