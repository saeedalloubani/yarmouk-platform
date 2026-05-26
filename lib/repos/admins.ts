// lib/repos/admins.ts
//
// Owner-side reads + writes on the admins allow-list. RLS admins_owner_all
// gates everything here — a readonly admin's call would return zero rows on
// SELECT and 23514/RLS error on writes. The calling actions also owner-gate.
//
// SCOPE: this module exists for the team-management UI (supervisor invite,
// roster, removal). It does NOT replace `current_admin()` / `current_admin_
// role()` — those continue to be the role-resolution primitives. This is
// for managing OTHER admins, not asking "who am I".
//
// Two structural guards live in the DB and are RELIED ON (not duplicated
// here): Inv1 tg_admins_no_runtime_owner_escalation blocks NEW.role='owner'
// from any application context (auth.jwt() IS NOT NULL); Inv2 tg_admins_
// protect_last_owner blocks demoting/deactivating/deleting the last active
// owner. Inserts here use role='readonly' (the action layer hard-codes it
// and never accepts role from input).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type AdminRoleEnum = Database["public"]["Enums"]["admin_role"];

/** Admin row shape returned to the team UI. No PII beyond email + name. */
export type AdminListView = {
  id: string;
  email: string;
  name: string;
  role: AdminRoleEnum;
  status: "pending" | "active" | "removed";
  invitedAt: string;
  activatedAt: string | null;
  removedAt: string | null;
};

const COLS =
  "id, email, name, role, status, invited_at, activated_at, removed_at";

function rowToView(r: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  invited_at: string;
  activated_at: string | null;
  removed_at: string | null;
}): AdminListView {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as AdminRoleEnum,
    // Safe cast: the status CHECK constraint enforces exactly these three
    // values at the DB level (20260519170002_tables.sql lines 19-20).
    status: r.status as "pending" | "active" | "removed",
    invitedAt: r.invited_at,
    activatedAt: r.activated_at,
    removedAt: r.removed_at,
  };
}

/**
 * List all admins (owner + readonly, active + pending + removed). Caller
 * decides ordering; this returns them in (role, email) order for stable
 * default display. Removed rows are INCLUDED — the team UI shows them in a
 * separate "Removed" section for the historical record.
 */
export async function listAdmins(
  supabase: SupabaseClient<Database>
): Promise<AdminListView[]> {
  const { data, error } = await supabase
    .from("admins")
    .select(COLS)
    .order("role", { ascending: true }) // 'owner' sorts before 'readonly'
    .order("email", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToView);
}

/**
 * Look up an admin by email (case-insensitive — admins.email is stored
 * lowercase per the admins_email_lowercase CHECK; we lowercase the lookup
 * key defensively in case a caller forgets). Returns null when absent.
 * Used by the invite action's pre-flight ("already an admin?") check.
 */
export async function getAdminByEmail(
  supabase: SupabaseClient<Database>,
  email: string
): Promise<AdminListView | null> {
  const { data, error } = await supabase
    .from("admins")
    .select(COLS)
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data ? rowToView(data) : null;
}

/**
 * Insert a new admin row. role is taken from input but the calling action
 * MUST hard-code 'readonly' — Inv1 (tg_admins_no_runtime_owner_escalation)
 * rejects any value other than 'readonly' from a JWT-bearing context anyway,
 * so a forgotten hard-code surfaces as a 42501 error, not silent escalation.
 *
 * status='active' from the start (matches the seed convention in
 * 20260519170014): the magic-link email is the auth challenge; controlling
 * the inbox = sign-in. A pending→active activation step would add ceremony
 * without adding security.
 */
export async function insertAdmin(
  supabase: SupabaseClient<Database>,
  input: {
    email: string;
    name: string;
    role: "readonly"; // intentionally narrower than the enum — caller cannot pass 'owner'
  }
): Promise<AdminListView> {
  const { data, error } = await supabase
    .from("admins")
    .insert({
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      status: "active",
      activated_at: new Date().toISOString(),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return rowToView(data);
}
