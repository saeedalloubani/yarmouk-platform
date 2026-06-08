"use client";

// components/AdminShell.tsx
//
// Admin console sidebar shell (Session 4 — admin dashboard). Mirrors the
// mock's left sidebar, trimmed to the routes that actually exist. The auth
// guard stays in the Server Component layout; this client island only needs
// usePathname for active-link highlighting + the admin's {name, role} for
// the footer and role-gated nav.
//
// ROLE GATE: the owner-only nav items are appended ONLY for owners — a
// readonly admin's nav array never contains them (absent, not CSS-hidden).
// The page-level owner gates on those routes remain the real enforcement;
// this just keeps the links out of sight.
//
// D91 — Sidebar IA restructure into three functional sections:
//
//   RESEARCH         Overview, Invitations, Responses, Analytics, Exports
//   INSTRUMENT       Questionnaires
//   ADMINISTRATION   Settings, Team, Email templates, Security
//
// Section headers are static labels (lighter build; not nested/expandable).
// Items keep their existing hrefs + labels verbatim — bookmarks intact, no
// route changes. Owner gating moved off the `...(role === "owner" ? [...]
// : [])` spread and onto a per-item `ownerOnly` flag, then sections are
// emitted only when their post-filter item list is non-empty. For a
// readonly admin INSTRUMENT and ADMINISTRATION disappear entirely, leaving
// a single RESEARCH section with the four both-roles items.
//
// D91 — Active-item resolver rewritten to longest-prefix-wins. Old logic
// (D87) used a per-item prefix fallback (`pathname.startsWith(item.href +
// "/")`) that double-lit Settings whenever the user was on a URL-nested
// sibling (Team or Email templates), since both Settings AND the deeper
// item matched. Switching to "longest matching href wins" makes the active
// item structurally unique — no per-item knobs to remember when future
// nested items get added. The /admin exact-match guard for Overview is
// preserved (otherwise "/admin" would prefix-match every admin page).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import NotificationsBell from "@/components/NotificationsBell";
import type { NotificationView } from "@/lib/repos/notifications";

type Admin = { name: string; role: "owner" | "readonly" };

// `matchPrefix` (D87) — opt-in subtree highlight target. When set, the
// active-resolver treats this string (instead of `href`) as the prefix to
// match against pathname. Used by the Analytics entry whose canonical
// landing page is /admin/analytics/questions but should also stay lit on
// sibling sub-routes like /admin/analytics/feedback.
//
// `ownerOnly` (D91) — gate the item to the "owner" role. Filtered out for
// readonly admins before sections are emitted.
type NavItem = {
  href: string;
  label: string;
  matchPrefix?: string;
  ownerOnly?: boolean;
};

type NavSection = { title: string; items: NavItem[] };

// Full nav schema — all items, all roles. Role filtering and empty-section
// hiding happen at render time below. Order within each section is the
// final on-screen order.
const NAV_SCHEMA: NavSection[] = [
  {
    title: "Research",
    items: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/invitations", label: "Invitations" },
      { href: "/admin/responses", label: "Responses" },
      {
        href: "/admin/analytics/questions",
        label: "Analytics",
        matchPrefix: "/admin/analytics",
      },
      { href: "/admin/exports", label: "Exports", ownerOnly: true },
    ],
  },
  {
    title: "Instrument",
    items: [
      {
        href: "/admin/questionnaires",
        label: "Questionnaires",
        ownerOnly: true,
      },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/settings", label: "Settings", ownerOnly: true },
      { href: "/admin/settings/team", label: "Team", ownerOnly: true },
      {
        href: "/admin/settings/email-templates",
        label: "Email templates",
        ownerOnly: true,
      },
      { href: "/admin/security", label: "Security", ownerOnly: true },
    ],
  },
];

// D91 — Longest-prefix-wins active resolver. Walks every visible nav item
// once, picks the one whose match-target (matchPrefix ?? href) is the
// longest string that is either equal to pathname or a directory-prefix
// of it. Returns the chosen item's href, or null if nothing matches.
//
// Why longest-wins instead of a per-item exactMatch knob: structurally
// rules out double-highlight regardless of which nested items get added
// later. A future flat-but-URL-nested sibling (say /admin/settings/foo)
// can't accidentally light Settings + Foo together because Foo's match
// target will always be the longer string.
//
// /admin gets a special branch: its raw href is a prefix of every admin
// route, so left to the generic rule it would always be the loser-tied-
// for-zero or sometimes the only match. Force exact-match only.
function findActiveHref(
  pathname: string,
  items: readonly NavItem[],
): string | null {
  let bestHref: string | null = null;
  let bestLength = -1;
  for (const item of items) {
    if (item.href === "/admin") {
      // Overview: exact match only. /admin/* never lights Overview.
      if (pathname === "/admin" && "/admin".length > bestLength) {
        bestHref = item.href;
        bestLength = "/admin".length;
      }
      continue;
    }
    const target = item.matchPrefix ?? item.href;
    const matches =
      pathname === target || pathname.startsWith(`${target}/`);
    if (matches && target.length > bestLength) {
      bestHref = item.href;
      bestLength = target.length;
    }
  }
  return bestHref;
}

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

  // D91 — Filter items by role FIRST, then emit a section only if its
  // post-filter item list is non-empty. Empty section headers must not
  // render (readonly admins would otherwise see an empty INSTRUMENT and
  // ADMINISTRATION). Section visibility derives from the post-filter
  // list, never from the static schema.
  const visibleSections: NavSection[] = NAV_SCHEMA.map((section) => ({
    title: section.title,
    items: section.items.filter(
      (item) => !item.ownerOnly || admin.role === "owner",
    ),
  })).filter((section) => section.items.length > 0);

  // Single-pass active resolution across all visible items. Computed once
  // per render; the per-item render just compares its own href.
  const allVisibleItems = visibleSections.flatMap((s) => s.items);
  const activeHref = findActiveHref(pathname, allVisibleItems);

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

        <nav className="py-3 flex-1 overflow-y-auto" aria-label="Admin sections">
          {visibleSections.map((section, idx) => (
            <div key={section.title} className={idx === 0 ? "" : "mt-4"}>
              <div
                className="mx-2 px-3 mb-1 text-[11px] font-semibold text-muted uppercase tracking-wider"
                aria-hidden="true"
              >
                {section.title}
              </div>
              {section.items.map((item) => {
                const active = item.href === activeHref;
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
            </div>
          ))}
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
