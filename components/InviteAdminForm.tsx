"use client";

// components/InviteAdminForm.tsx
//
// Owner-only invite form. Two inputs (name + email), one button. On success
// → router.refresh() so the team page re-fetches and the new supervisor
// appears in the read-only section. On the email-failed branch (admins row
// created but Resend choked) → surface that explicitly so the owner knows
// to follow up rather than silently assuming the link arrived.
//
// The action hard-codes role='readonly' — there is no role input here by
// design. Inv1 (tg_admins_no_runtime_owner_escalation) is the structural
// backstop; this form is the matching UI restriction.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  inviteAdminAction,
  type InviteAdminResult,
} from "@/lib/actions/admins";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; emailed: boolean; email: string }
  | { kind: "error"; message: string };

export default function InviteAdminForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const n = name.trim();
    const em = email.trim();
    if (n.length === 0 || em.length === 0) {
      setStatus({ kind: "error", message: "Name and email are required." });
      return;
    }
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await inviteAdminAction({ name: n, email: em });
      if (res.ok) {
        setStatus({ kind: "ok", emailed: res.emailed, email: em });
        setName("");
        setEmail("");
        router.refresh();
        return;
      }
      setStatus({ kind: "error", message: messageFor(res) });
    });
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="invite-admin-name">
              Name
            </label>
            <input
              id="invite-admin-name"
              type="text"
              required
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. Mutawakkil Obeidat"
              disabled={pending}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="invite-admin-email">
              Email
            </label>
            <input
              id="invite-admin-email"
              type="email"
              required
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@institution.edu"
              disabled={pending}
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="btn-primary text-[13px] disabled:opacity-40"
          >
            {pending ? "Inviting…" : "Send invitation"}
          </button>
        </div>
      </form>

      {/* Result surface */}
      {status.kind === "ok" && status.emailed && (
        <div className="mt-3 text-[13px] text-accent-700">
          ✓ Invited {status.email}. Sign-in link sent.
        </div>
      )}
      {status.kind === "ok" && !status.emailed && (
        <div className="mt-3 notice-warn text-[13px]">
          Admin row created for <strong>{status.email}</strong>, but the
          sign-in email failed to send. They can still sign in from the
          standard <code>/admin/login</code> page — Supabase will deliver a
          fresh magic link the moment they request one.
        </div>
      )}
      {status.kind === "error" && (
        <div className="mt-3 text-[13px] text-danger">{status.message}</div>
      )}
    </div>
  );
}

function messageFor(res: Extract<InviteAdminResult, { ok: false }>): string {
  switch (res.error) {
    case "forbidden":
      return "Owner-only action.";
    case "validation":
      return res.issues?.join(" ") ?? "Please check the form values.";
    case "email_already_admin":
      return "That email is already on the team.";
    case "email_already_auth_user":
      return "That email already has a sign-in identity in Supabase Auth. Reach out to the project administrator to reconcile.";
    case "server":
      return "Something went wrong. Try again — if it persists, check the server log.";
  }
}
