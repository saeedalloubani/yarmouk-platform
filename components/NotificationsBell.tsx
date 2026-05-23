"use client";

// components/NotificationsBell.tsx
//
// Owner-only notification bell (Session — notifications). Rendered in the
// AdminShell header ONLY for owners — a readonly admin never gets it, and has
// no notification rows anyway (safe by absence). Server-fetched data arrives
// as props from the force-dynamic protected layout; mark-read calls the server
// actions then router.refresh() to re-run the layout and update the count.
//
// No realtime push — notifications appear on load/refresh, fine at pilot scale.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NotificationView } from "@/lib/repos/notifications";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/lib/actions/notifications";

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationView[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleOpenItem(n: NotificationView) {
    setOpen(false);
    if (!n.readAt) {
      await markNotificationReadAction(n.id);
    }
    if (n.href) {
      router.push(n.href);
    }
    router.refresh();
  }

  async function handleMarkAll() {
    if (busy || unreadCount === 0) return;
    setBusy(true);
    try {
      await markAllNotificationsReadAction();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-haspopup="true"
        aria-expanded={open}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-md text-muted hover:bg-bgAlt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold leading-4 text-center">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-line rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
            <span className="text-[13px] font-semibold text-ink">
              Notifications
            </span>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={busy || unreadCount === 0}
              className="text-[12px] font-medium text-brand-700 hover:underline disabled:text-muted disabled:no-underline disabled:cursor-default"
            >
              Mark all read
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-muted text-center">
              No notifications yet.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenItem(n)}
                    className={`w-full text-start px-4 py-3 border-b border-line last:border-b-0 hover:bg-bgAlt transition-colors ${
                      n.readAt ? "" : "bg-brand-50/40"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span
                          className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-600 flex-shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div className={`flex-1 min-w-0 ${n.readAt ? "ps-3.5" : ""}`}>
                        <div className="text-[13px] font-medium text-ink">
                          {n.title}
                        </div>
                        {n.body && (
                          <div className="text-[12px] text-muted truncate">
                            {n.body}
                          </div>
                        )}
                        <div className="text-[11px] text-muted mt-0.5">
                          {formatRelative(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
