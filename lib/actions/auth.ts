"use server";

// lib/actions/auth.ts
//
// Admin sign-out. Clears the Supabase auth session (cookies) via the
// authenticated server client, then redirects to the login page.

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
