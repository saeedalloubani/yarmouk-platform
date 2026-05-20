// lib/supabase/middleware.ts
//
// Supabase session refresh for the admin area. The @supabase/ssr docs
// require running this on every protected request so the auth token is
// rotated and the server client (createSupabaseServerClient) sees a fresh
// session. server.ts's setAll comment already anticipates this.
//
// REFRESH ONLY — no redirects. All authorization redirects live in
// app/admin/(protected)/layout.tsx (D50), which has DB access for the
// role check. Keeping middleware redirect-free avoids the login/callback
// exemption logic and keeps a single source of redirect truth.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

export async function updateSession(
  request: NextRequest
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies onto both the request (for any
          // downstream read in this pass) and the outgoing response.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the auth state so @supabase/ssr rotates the token if needed.
  // Do NOT branch on the result here — the layout guard owns redirects.
  await supabase.auth.getUser();

  return response;
}
