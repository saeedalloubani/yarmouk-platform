// app/admin/(protected)/analytics/layout.tsx
//
// D87 — Shared layout for the /admin/analytics/* subtree. Introduces a
// thin horizontal sub-nav (Questions / Feedback) so the two sibling
// pages feel like one section, with room to grow as more analytics
// views land (themes / demographics / timeline). The parent
// (protected) layout still wraps this with AdminShell (sidebar +
// auth guard).
//
// CLIENT ISLAND: tabs need usePathname for active-link highlighting,
// so the nav lives in a tiny client component (AnalyticsSubNav).
// Everything else stays Server.
//
// NO ROLE GATE: both /analytics/questions and /analytics/feedback are
// non-PII research data (ref_code is the public handle), both-roles
// pages. The per-page redirects (if any) still apply on top of this.

import AnalyticsSubNav from "@/components/AnalyticsSubNav";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <AnalyticsSubNav />
      {children}
    </div>
  );
}
