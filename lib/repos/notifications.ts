// lib/repos/notifications.ts
//
// Reads + writes for `notifications` (Session — notifications). The table
// was purpose-built in 2a: per-recipient (recipient_admin_id), unread =
// (read_at IS NULL), with the unread + recent indexes already in place.
//
// TWO CLIENT PATHS, by design (see migration 004 RLS):
//   - READ / MARK-READ (list, unreadCount, markRead, markAllRead): take the
//     AUTHENTICATED server client. RLS n_self_select / n_self_update scope
//     every row to current_admin_id() — an admin only ever sees / mutates
//     their own. A readonly admin sees nothing, because no row ever targets
//     them (safe by absence, not by hiding).
//   - WRITE / OWNER-RESOLVE (createNotification, getActiveOwners): take the
//     SERVICE-ROLE admin client, used from the respondent submit path which
//     has no admin JWT. There is deliberately NO authenticated INSERT policy
//     — inserts come via service_role, which bypasses RLS (migration 004
//     line 244). getActiveOwners likewise needs to read admins without an
//     admin identity, so it runs on the service-role path.
//
// NON-PII: notification content is identity-free (ref_code, never the
// respondent's name). admins.email is plaintext (not encrypted) — no
// decrypt needed for the email fan-out.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type NotificationType = Database["public"]["Enums"]["notification_type"];

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ActiveOwner = {
  id: string;
  email: string;
};

export type OwnerToNotify = {
  id: string;
  email: string;
  submissionInapp: boolean;
  submissionEmail: boolean;
};

const NOTIFICATION_COLS = "id, type, title, body, href, read_at, created_at";

function rowToView(r: {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}): NotificationView {
  return {
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    href: r.href,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/**
 * Recent notifications for the calling admin (AUTHENTICATED client; RLS
 * scopes to self), newest first. Default cap keeps the dropdown bounded.
 */
export async function listNotificationsForAdmin(
  supabase: SupabaseClient<Database>,
  limit = 20
): Promise<NotificationView[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToView);
}

/**
 * Count of UNREAD notifications for the calling admin (AUTHENTICATED client;
 * RLS scopes to self). head:true → no rows transferred, just the count.
 */
export async function getUnreadCount(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Insert one notification. SERVICE-ROLE client (RLS-bypass — there is no
 * authenticated INSERT policy by design). Caller assigns the recipient.
 */
export async function createNotification(
  supabase: SupabaseClient<Database>,
  input: {
    recipientAdminId: string;
    type: NotificationType;
    title: string;
    body?: string;
    href?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    recipient_admin_id: input.recipientAdminId,
    type: input.type,
    title: input.title,
    body: input.body ?? "",
    href: input.href ?? null,
  });
  if (error) throw error;
}

/**
 * Mark one notification read (AUTHENTICATED client). RLS n_self_update means
 * an admin can only ever flip their own row; the .is(read_at, null) guard
 * preserves the original read time on a double-click and makes it idempotent.
 */
export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw error;
}

/**
 * Mark every unread notification read for the calling admin (AUTHENTICATED
 * client; RLS scopes to self).
 */
export async function markAllNotificationsRead(
  supabase: SupabaseClient<Database>
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}

/**
 * Active owners to notify on submit. SERVICE-ROLE client (the respondent
 * submit path has no admin JWT). Returns id + plaintext email (admins.email
 * is not encrypted). All active owners are notified (D-decision: simplest +
 * correct — two owners today get both an in-app row and an email).
 */
export async function getActiveOwners(
  supabase: SupabaseClient<Database>
): Promise<ActiveOwner[]> {
  const { data, error } = await supabase
    .from("admins")
    .select("id, email")
    .eq("role", "owner")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, email: r.email }));
}

/**
 * Active owners to notify on submit, each annotated with their two submission
 * preferences. SERVICE-ROLE client (the respondent submit path has no admin
 * JWT) — same path as getActiveOwners; runs RLS-bypass.
 *
 * "No row = ON": notification_preferences has no row for an owner until one is
 * written, and a missing row means the column DEFAULT never fires — so we can
 * NOT lean on the DB default. We default every owner to BOTH flags true and
 * only override from a matching preferences row when one exists.
 *
 * Two queries joined IN MEMORY (owners, then their preferences by id) rather
 * than a PostgREST embed — consistent with this project's join-in-memory
 * convention; an inner embed onto notification_preferences would also silently
 * drop owners who have no preferences row at all (exactly the "no row = ON"
 * case we must preserve).
 */
export async function getActiveOwnersToNotify(
  supabase: SupabaseClient<Database>
): Promise<OwnerToNotify[]> {
  // 1. Active owners — same query shape as getActiveOwners.
  const { data: owners, error: ownersErr } = await supabase
    .from("admins")
    .select("id, email")
    .eq("role", "owner")
    .eq("status", "active");
  if (ownersErr) throw ownersErr;
  if (!owners || owners.length === 0) return [];

  // 2. Their preferences, scoped to just those owner ids (read no more than
  //    needed). Owners with no row simply won't appear here.
  const ownerIds = owners.map((o) => o.id);
  const { data: prefs, error: prefsErr } = await supabase
    .from("notification_preferences")
    .select("admin_id, submission_inapp, submission_email")
    .in("admin_id", ownerIds);
  if (prefsErr) throw prefsErr;

  const prefByAdmin = new Map(
    (prefs ?? []).map((p) => [p.admin_id, p] as const)
  );

  // 3. Left-join in memory: default BOTH flags true (no row = ON), override
  //    only when a matching preferences row exists.
  return owners.map((o) => {
    const p = prefByAdmin.get(o.id);
    return {
      id: o.id,
      email: o.email,
      submissionInapp: p ? p.submission_inapp : true,
      submissionEmail: p ? p.submission_email : true,
    };
  });
}
