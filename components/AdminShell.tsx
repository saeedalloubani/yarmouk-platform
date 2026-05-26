"use client";

// components/AdminShell.tsx
//
// Admin console sidebar shell (Session 4 — admin dashboard). Mirrors the
// mock's left sidebar, trimmed to the routes that actually exist. The auth
// guard stays in the Server Component layout; this client island only needs
// usePathname for active-link highlighting + the admin's {name, role} for
// the footer and role-gated nav.
//
// ROLE GATE: the owner-only nav items (Questionnaires, Settings, Team,
// Security) are appended ONLY for owners — a readonly admin's nav array
// never contains them (absent, not CSS-hidden). The page-level owner gates
// on those routes remain the real enforcement; this just keeps the links
// out of sight. Security (the audit-log viewer) and Team (the supervisor-
// invite surface) are now wired. The remaining Analytics / Data / Comms
// groups are still omitted until those pages exist.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import NotificationsBell from "@/components/NotificationsBell";
import type { NotificationView } from "@/lib/repos/notifications";

type Admin = { name: string; role: "owner" | "readonly" };
type NavItem = { href: string; label: string };

export default function AdminShell({
  admin,
  notifications,
  unreadCount,
  children,
}: {
  admin: Admin;
  notifications: NotificationView[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const nav: NavItem[] = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/invitations", label: "Invitations" },
    { href: "/admin/responses", label: "Responses" },
    // Both-roles analytics. Single flat entry for now — promote to an
    // "Analytics" group once a 2nd view lands.
    { href: "/admin/analytics/feedback", label: "Feedback" },
    // Owner-only: instrument editing (question-editor boundary), self-service
    // settings, and the audit-log viewer.
    ...(admin.role === "owner"
      ? [
          { href: "/admin/questionnaires", label: "Questionnaires" },
          { href: "/admin/settings", label: "Settings" },
          { href: "/admin/settings/team", label: "Team" },
          { href: "/admin/security", label: "Security" },
        ]
      : []),
  ];

  function isActive(href: string): boolean {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const initials =
    admin.name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="min-h-screen flex bg-bgAlt" dir="ltr">
      <aside className="w-64 bg-white border-e border-line flex flex-col flex-shrink-0">
        <Link href="/admin" className="px-5 py-5 border-b border-line block">
          <div className="text-[15px] font-bold text-ink leading-tight tracking-tight">
            Yarmouk Study
          </div>
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            Admin Console
          </div>
        </Link>

        <nav className="py-3 flex-1 overflow-y-auto">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block mx-2 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-muted hover:bg-bgAlt hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-[12px] font-bold flex items-center justify-center flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink truncate">
                {admin.name}
              </div>
              <div className="text-[11px] text-muted capitalize">{admin.role}</div>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="text-muted hover:text-ink text-[12px]"
                title="Sign out"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top header strip. The bell is owner-only — a readonly admin has no
            notifications and gets no bell (the header stays empty for them,
            keeping layout consistent). Pages keep their own padding/headings;
            this strip just hosts the bell, right-aligned. */}
        {admin.role === "owner" && (
          <header className="h-14 flex-shrink-0 border-b border-line bg-white flex items-center justify-end px-6">
            <NotificationsBell
              notifications={notifications}
              unreadCount={unreadCount}
            />
          </header>
        )}
        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
