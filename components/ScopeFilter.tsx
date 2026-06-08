"use client";

// components/ScopeFilter.tsx
//
// D94 — Pilot / Main / All scope control for the Invitations + Responses
// LIST pages. Distinct from D93's dashboard ScopeSelector (which is a
// server-rendered, /admin-hardcoded, flash-dropping local component): the
// lists carry OTHER filters in the URL (?withdrawn=show, future
// status/category), so this control must PRESERVE every existing query
// param while flipping ?scope=. It does that generically via
// usePathname + useSearchParams, so it works on any list page and the
// scope filter composes (AND) with whatever else is in the URL.
//
// Shares the resolver's labels (SCOPE_LABEL) + the OverviewScope type
// from lib/repos/scope.ts — the scope vocabulary has one source of truth.
//
// The active scope is passed in (the page already resolved it via
// resolveOverviewScope); we don't re-derive it from the URL so the
// highlighted chip always matches what the page actually rendered
// (including the lists' default-to-All when ?scope= is absent).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SCOPE_LABEL, type OverviewScope } from "@/lib/repos/scope";

const SCOPE_ORDER: readonly OverviewScope[] = ["pilot", "main", "all"];

// One-shot flash params from POST redirects (e.g. the reminder banner on
// /admin/invitations). A scope click must NOT carry these forward — the
// banner is transient. Every OTHER param (withdrawn, …) IS preserved so
// the scope filter composes with the list's existing filters.
const TRANSIENT_PARAMS = new Set(["reminder", "ref", "reason", "wait"]);

export default function ScopeFilter({ active }: { active: OverviewScope }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function hrefFor(scope: OverviewScope): string {
    const params = new URLSearchParams();
    // Preserve existing params (except scope itself + transient flash).
    for (const [key, value] of searchParams.entries()) {
      if (key === "scope" || TRANSIENT_PARAMS.has(key)) continue;
      params.set(key, value);
    }
    params.set("scope", scope);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <nav
      className="inline-flex items-center gap-1 rounded-md bg-bgAlt p-0.5"
      aria-label="Study scope"
    >
      {SCOPE_ORDER.map((s) => {
        const isActive = s === active;
        return (
          <Link
            key={s}
            href={hrefFor(s)}
            aria-current={isActive ? "page" : undefined}
            className={`px-2.5 py-1 rounded text-[12px] font-medium transition-colors ${
              isActive
                ? "bg-brand-700 text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            {SCOPE_LABEL[s]}
          </Link>
        );
      })}
    </nav>
  );
}
