"use client";

// components/InvitationCreateForm.tsx
//
// Owner-only invitation create form (3b-i). Collects recipient + routing
// fields, calls createInvitationAction, and on success renders the
// one-time /r/<token> URL (D53) with a copy button and a "shown once"
// notice — never re-fetchable. No email is sent (that's 3b-ii); this
// surface is for manual hand-off / testing.

import { useState, useTransition } from "react";
import {
  createInvitationAction,
  type NewInvitationInput,
  type CreateInvitationResult,
} from "@/lib/actions/invitations";

type VersionOption = { id: string; label: string };

function defaultExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for <input type="date">
}

export default function InvitationCreateForm({
  versions,
}: {
  versions: VersionOption[];
}) {
  const [form, setForm] = useState<NewInvitationInput>({
    name: "",
    email: "",
    category: "officials",
    nationality: "jordanian",
    preferredLanguage: "en",
    refCode: "",
    questionnaireVersionId: versions[0]?.id ?? "",
    expiresAt: defaultExpiry(),
    maxUses: 1,
    sendEmail: true,
  });
  const [result, setResult] = useState<CreateInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof NewInvitationInput>(
    key: K,
    value: NewInvitationInput[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      const res = await createInvitationAction(form);
      setResult(res);
    });
  }

  // Success view — show the one-time token URL.
  if (result?.ok) {
    const sendWasRequested = form.sendEmail;
    return (
      <div className="card p-6">
        {result.emailed ? (
          <div className="notice-success mb-4">
            <span>
              Invitation{" "}
              <span className="mono font-semibold">{result.refCode}</span> created
              and emailed to the recipient.
            </span>
          </div>
        ) : sendWasRequested ? (
          <div className="notice-warn mb-4">
            <div>
              <strong>
                Invitation {result.refCode} created, but the email could not be
                sent.
              </strong>{" "}
              Copy the link below and send it to the recipient manually.
            </div>
          </div>
        ) : (
          <div className="notice-success mb-4">
            <span>
              Invitation{" "}
              <span className="mono font-semibold">{result.refCode}</span>{" "}
              created.
            </span>
          </div>
        )}
        <div className="label mb-1">Invitation link — shown once</div>
        <p className="text-[13px] text-muted-strong mb-3">
          Copy this now. It is <strong>not stored and cannot be recovered</strong>;
          to re-issue, use Resend (which mints a new link).
        </p>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            className="field mono text-[12px] flex-1"
            value={result.tokenUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(result.tokenUrl);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-6">
          <a href="/admin/invitations" className="btn-ghost text-[13px]">
            ← Back to invitations
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      {result && !result.ok && (
        <div className="notice-warn">
          <div>
            {result.error === "ref_code_taken" && (
              <span>That ref code is already in use — pick another.</span>
            )}
            {result.error === "forbidden" && (
              <span>Only the owner can create invitations.</span>
            )}
            {result.error === "server" && (
              <span>Something went wrong. Please try again.</span>
            )}
            {result.error === "validation" && (
              <div>
                <strong>Please fix:</strong>
                <ul className="list-disc ms-5 mt-1">
                  {result.issues?.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Recipient name</label>
          <input
            className="field"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Recipient email</label>
          <input
            type="email"
            className="field"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Ref code</label>
          <input
            className="field mono"
            placeholder="OFF-J-04"
            value={form.refCode}
            onChange={(e) => set("refCode", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Questionnaire version</label>
          <select
            className="field"
            value={form.questionnaireVersionId}
            onChange={(e) => set("questionnaireVersionId", e.target.value)}
          >
            {versions.length === 0 && <option value="">No active version</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select
            className="field"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="officials">Officials</option>
            <option value="researchers">Researchers</option>
            <option value="donors">Donors</option>
            <option value="ngos">NGOs</option>
          </select>
        </div>
        <div>
          <label className="label">Nationality</label>
          <select
            className="field"
            value={form.nationality}
            onChange={(e) => set("nationality", e.target.value)}
          >
            <option value="jordanian">Jordanian</option>
            <option value="syrian">Syrian</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </div>
        <div>
          <label className="label">Preferred language</label>
          <select
            className="field"
            value={form.preferredLanguage}
            onChange={(e) => set("preferredLanguage", e.target.value)}
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </div>
        <div>
          <label className="label">Expires</label>
          <input
            type="date"
            className="field"
            value={form.expiresAt}
            onChange={(e) => set("expiresAt", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Max uses</label>
          <input
            type="number"
            min={1}
            className="field"
            value={form.maxUses}
            onChange={(e) => set("maxUses", Number(e.target.value))}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[14px] text-ink cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={form.sendEmail}
          onChange={(e) => set("sendEmail", e.target.checked)}
        />
        Send the invitation email now
      </label>

      <div className="flex items-center justify-between gap-4 pt-2">
        <a href="/admin/invitations" className="btn-ghost text-[13px]">
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Creating…" : form.sendEmail ? "Create & send" : "Create invitation"}
        </button>
      </div>
    </form>
  );
}
