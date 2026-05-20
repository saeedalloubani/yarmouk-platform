// middleware.ts
//
// Runs Supabase session refresh on /admin/* (D50). Scoped to the admin
// area only — the respondent flow uses its own yarmouk_session cookie,
// not Supabase auth, so it needs no refresh here.
//
// Refresh only; authorization redirects live in the (protected) layout.

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
