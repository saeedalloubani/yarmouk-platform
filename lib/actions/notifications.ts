"use server";

// lib/actions/notifications.ts
//
// Mark-read actions for the owner's notification bell (Session — notifications).
//
// OWNER-GATED at the app layer; RLS n_self_update is the DB backstop (an admin
// can only ever flip their own rows). NOT AUDITED (D54): marking your own
// notification read is a trivial self-action — like opening your own email —
// not a research-data mutation. We log nothing to audit_log here.
//
// Authenticated server client → RLS applies (current_admin_id() scopes the
// update to self). Returns { ok } so the client island can refresh on success.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/repos/notifications";

export async function markNotificationReadAction(
  id: string
): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") return { ok: false };

  try {
    await markNotificationRead(supabase, id);
    return { ok: true };
  } catch (e) {
    console.error("[notify] markRead failed —", (e as Error).message);
    return { ok: false };
  }
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") return { ok: false };

  try {
    await markAllNotificationsRead(supabase);
    return { ok: true };
  } catch (e) {
    console.error("[notify] markAllRead failed —", (e as Error).message);
    return { ok: false };
  }
}
