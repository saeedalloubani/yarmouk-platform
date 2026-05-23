// app/admin/(protected)/layout.tsx
//
// The admin authorization guard (D50). Wraps only the (protected) subtree —
// /admin/login, /admin/callback, /admin/unauthorized sit OUTSIDE it, so an
// unauthenticated bounce can't loop.
//
// Decision tree:
//   no session            → /admin/login
//   session, not an admin → /admin/unauthorized
//   active admin          → render children
//
// getUser() (not getSession()) revalidates the token against Supabase rather
// than trusting the cookie — the right check for protected server code.
// getCurrentAdmin uses this authenticated server client; the service-role
// client would have no email claim and resolve null (D50/Q4).

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  listNotificationsForAdmin,
  getUnreadCount,
  type NotificationView,
} from "@/lib/repos/notifications";
import AdminShell from "@/components/AdminShell";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/unauthorized");

  // Notifications are owner-only (no row ever targets readonly — safe by
  // absence). Fetch via the AUTHENTICATED client so RLS n_self_select scopes
  // to this admin. Skip the query entirely for readonly.
  let notifications: NotificationView[] = [];
  let unreadCount = 0;
  if (admin.role === "owner") {
    [notifications, unreadCount] = await Promise.all([
      listNotificationsForAdmin(supabase),
      getUnreadCount(supabase),
    ]);
  }

  // Guard passed → render the role-gated sidebar shell around the page.
  return (
    <AdminShell
      admin={{ name: admin.name, role: admin.role }}
      notifications={notifications}
      unreadCount={unreadCount}
    >
      {children}
    </AdminShell>
  );
}
