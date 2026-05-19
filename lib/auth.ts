// lib/auth.ts
//
// Server-side helpers for admin role resolution. Used by:
//   - Repos (lib/repos/*) to pick base table vs redacted view
//   - Server Actions (via requireRole — to be added in Session 3) to
//     gate mutations before they execute
//
// The DB function `current_admin_role()` is the source of truth. We
// expose a thin TS wrapper so repos don't need to know about RPC.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";

export type AdminRole = "owner" | "readonly" | null;

/**
 * Resolve the calling admin's role via the SECURITY DEFINER SQL function.
 *
 * Returns:
 *   - "owner"    — signed-in active Owner admin
 *   - "readonly" — signed-in active Read-only admin
 *   - null       — not an admin (anonymous, signed-in non-admin, or
 *                  removed admin)
 *
 * On RPC error we log and return null so the caller falls through to
 * the read-only path. Throwing here would bubble into every repo read.
 */
export async function getCurrentAdminRole(
  supabase: SupabaseClient<Database>
): Promise<AdminRole> {
  const { data, error } = await supabase.rpc("current_admin_role");
  if (error) {
    console.error("getCurrentAdminRole RPC failed:", error.message);
    return null;
  }
  return (data ?? null) as AdminRole;
}
