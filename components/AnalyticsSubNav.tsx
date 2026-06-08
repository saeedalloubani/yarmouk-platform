"use client";

// components/AnalyticsSubNav.tsx
//
// D87 — Horizontal sub-nav for /admin/analytics/*. Two tabs today
// (Questions, Feedback); the array shape leaves room for future
// siblings (themes / demographics / timeline) without touching the
// layout call site. Tiny client island — needed only for usePathname.

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };

const TABS: readonly Tab[] = [
  { href: "/admin/analytics/questions", label: "Questions" },
  { href: "/admin/analytics/feedback", label: "Feedback" },
];

export default function AnalyticsSubNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="border-b border-line bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <nav className="flex gap-1 -mb-px" aria-label="Analytics sections">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-3 text-[13px] font-medium border-b-2 transition-colors ${
                  active
                    ? "border-brand-700 text-brand-700"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
