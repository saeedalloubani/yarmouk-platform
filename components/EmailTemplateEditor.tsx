"use client";

// components/EmailTemplateEditor.tsx
//
// D22 — the editor surface for one email template. Two columns (EN +
// AR), one textarea per section, plus subject + a fixed placeholder
// reference. Three action buttons:
//
//   - Save  → updateTemplateAction. router.refresh() on ok, validation
//             issues surface inline.
//   - Reset → resetTemplateAction (deletes the row; defaults take over).
//             Browser confirm() guard before firing.
//   - Send test → sendTestEmailAction. Sends the CURRENT FORM STATE
//             (NOT yet saved) to a destination email of the owner's
//             choosing (defaults to the owner's own address). The
//             button href in the test email is INERT — clicking it goes
//             to the public landing page, never consumes a participant
//             token. Subject is prefixed with "[TEST] " and the body
//             carries a banner explaining the inert button.
//
// The saved-state PREVIEW is server-rendered by the parent page and
// passed in as enPreview / arPreview — we just iframe-srcdoc it. Edits
// don't reflect until Save (intentional — "Send test" is the way to see
// unsaved edits in a real mail client).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resetTemplateAction,
  sendTestEmailAction,
  updateTemplateAction,
  type SendTestEmailResult,
  type UpdateTemplateResult,
} from "@/lib/actions/email-templates";
import type {
  PlaceholderToken,
  RenderedPreview,
  SectionKey,
  TemplateId,
} from "@/lib/email/templates/types";

type SectionMap = Partial<Record<SectionKey, string>>;

const SECTION_LABELS: Record<SectionKey, { title: string; hint: string }> = {
  intro: {
    title: "Intro",
    hint: "Opening paragraph — what the recipient was invited to and why.",
  },
  cta: {
    title: "Button label",
    hint:
      "The text on the button. The URL is fixed by the system — only the label is editable.",
  },
  personal: {
    title: "Personal-link note",
    hint:
      "A short reminder that the link is personal and shouldn't be forwarded.",
  },
  access_code: {
    title: "Access-code fallback (6-digit)",
    hint:
      'Fallback line shown if the recipient\'s email service prefetches the link. Must contain "{access_code}" — replaced with the actual 6-digit code per recipient. Visible on invitation + both reminders.',
  },
  expiry: {
    title: "Expiry line",
    hint:
      'Must contain "{expiry_date}" — that placeholder is replaced with the actual expiry per recipient.',
  },
  contact: {
    title: "Contact line",
    hint:
      "Closing line with how to reach you. Any email or international phone (+962 …) you type here is automatically linkified.",
  },
  greeting: {
    title: "Greeting",
    hint:
      'Opener — must contain "{name}" so the recipient sees their own name. Example: "Hello {name},".',
  },
  notice: {
    title: "Fine-print notice",
    hint:
      "Short fine-print paragraph below the button — security/expiry hint, what to do if unexpected, etc.",
  },
  lead: {
    title: "Body",
    hint:
      'Single-paragraph body of the notification — must contain "{ref_code}" so you can identify which response landed.',
  },
};

type Banner =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "issues"; issues: string[] };

export default function EmailTemplateEditor(props: {
  templateId: TemplateId;
  sections: readonly SectionKey[];
  allowedPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
  requiredPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
  bilingual: boolean;
  ownerEmail: string;
  customized: boolean;
  initialEnSubject: string;
  initialEnSections: Partial<Record<SectionKey, string>>;
  initialArSubject: string | null;
  initialArSections: Partial<Record<SectionKey, string>> | null;
  enPreview: RenderedPreview;
  arPreview: RenderedPreview | null;
}) {
  const router = useRouter();
  const [pendingSave, startSave] = useTransition();
  const [pendingReset, startReset] = useTransition();
  const [pendingTest, startTest] = useTransition();

  const [enSubject, setEnSubject] = useState(props.initialEnSubject);
  const [enSections, setEnSections] = useState<SectionMap>({
    ...props.initialEnSections,
  });
  const [arSubject, setArSubject] = useState(props.initialArSubject ?? "");
  const [arSections, setArSections] = useState<SectionMap>(
    props.initialArSections ?? {}
  );

  const [testTo, setTestTo] = useState(props.ownerEmail);
  const [testLang, setTestLang] = useState<"en" | "ar">("en");
  const [saveBanner, setSaveBanner] = useState<Banner>({ kind: "idle" });
  const [testBanner, setTestBanner] = useState<Banner>({ kind: "idle" });

  const anyPending = pendingSave || pendingReset || pendingTest;

  // Memo: collated allowed-placeholder tokens to show in the reference.
  const allAllowedTokens = useMemo(() => {
    const set = new Set<string>();
    for (const k of props.sections) {
      for (const p of props.allowedPlaceholders[k]) set.add(p);
    }
    return Array.from(set);
  }, [props.allowedPlaceholders, props.sections]);

  function onSetEn(key: SectionKey, value: string) {
    setEnSections((s) => ({ ...s, [key]: value }));
  }
  function onSetAr(key: SectionKey, value: string) {
    setArSections((s) => ({ ...s, [key]: value }));
  }

  function buildInput() {
    return {
      id: props.templateId,
      en: { subject: enSubject, sections: enSections },
      ar: props.bilingual
        ? { subject: arSubject, sections: arSections }
        : null,
    };
  }

  function onSave() {
    if (anyPending) return;
    setSaveBanner({ kind: "idle" });
    startSave(async () => {
      const res = await updateTemplateAction(buildInput());
      surfaceSave(res);
      if (res.ok) router.refresh();
    });
  }

  function surfaceSave(res: UpdateTemplateResult) {
    if (res.ok) {
      setSaveBanner({ kind: "ok", message: "Saved." });
      return;
    }
    if (res.error === "validation" && res.issues) {
      setSaveBanner({ kind: "issues", issues: res.issues });
      return;
    }
    setSaveBanner({
      kind: "issues",
      issues: [
        res.error === "forbidden"
          ? "Owner-only action."
          : "Something went wrong saving. Try again.",
      ],
    });
  }

  function onReset() {
    if (anyPending) return;
    if (
      !window.confirm(
        "Discard your customizations for this template? The default English/Arabic copy will be restored."
      )
    )
      return;
    setSaveBanner({ kind: "idle" });
    startReset(async () => {
      const res = await resetTemplateAction(props.templateId);
      if (res.ok) {
        setSaveBanner({ kind: "ok", message: "Reset to default." });
        router.refresh();
      } else {
        setSaveBanner({
          kind: "issues",
          issues: [
            res.error === "forbidden"
              ? "Owner-only action."
              : "Something went wrong resetting. Try again.",
          ],
        });
      }
    });
  }

  function onSendTest() {
    if (anyPending) return;
    setTestBanner({ kind: "idle" });
    startTest(async () => {
      const res = await sendTestEmailAction({
        id: props.templateId,
        lang: testLang,
        to: testTo,
        en: { subject: enSubject, sections: enSections },
        ar: props.bilingual
          ? { subject: arSubject, sections: arSections }
          : null,
      });
      surfaceTest(res);
    });
  }

  function surfaceTest(res: SendTestEmailResult) {
    if (res.ok) {
      setTestBanner({ kind: "ok", message: `Test sent to ${res.to}.` });
      return;
    }
    if (res.error === "validation" && res.issues) {
      setTestBanner({ kind: "issues", issues: res.issues });
      return;
    }
    if (res.error === "rate_limited") {
      setTestBanner({
        kind: "issues",
        issues: [
          `Slow down — wait ${res.retryAfterSeconds ?? 30}s before sending another test.`,
        ],
      });
      return;
    }
    setTestBanner({
      kind: "issues",
      issues: [
        res.error === "forbidden"
          ? "Owner-only action."
          : res.error === "send_failed"
            ? "Send failed (Resend error). Check the server log."
            : "Something went wrong. Try again.",
      ],
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT: editor form */}
      <section className="card p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-ink">Edit copy</h2>
            <p className="text-[12px] text-muted mt-1">
              The sign-in button and the layout are fixed. Edit the words
              below; placeholders in <code>&#123; &#125;</code> are filled in
              per recipient.
            </p>
          </div>
          <div className="flex-shrink-0">
            {props.customized ? (
              <span className="chip-solid bg-brand-50 text-brand-700">
                customized
              </span>
            ) : (
              <span className="chip-solid bg-bgAlt text-muted">default</span>
            )}
          </div>
        </div>

        {/* Placeholder reference */}
        {allAllowedTokens.length > 0 && (
          <div className="bg-bgAlt rounded-md p-3 text-[12px] text-muted">
            <strong className="text-ink">Available placeholders:</strong>{" "}
            {allAllowedTokens.map((t) => (
              <code key={t} className="ms-1">{`{${t}}`}</code>
            ))}
            <div className="mt-1">
              The button URL is system-owned (never a placeholder, never
              editable). Named placeholders above are filled in per
              recipient at send time.
            </div>
          </div>
        )}

        {/* English */}
        <div>
          <h3 className="text-[14px] font-bold text-ink mb-3">English</h3>
          <div className="space-y-3">
            <Field
              label="Subject"
              value={enSubject}
              onChange={setEnSubject}
              disabled={anyPending}
              required
            />
            {props.sections.map((key) => (
              <SectionField
                key={`en-${key}`}
                section={key}
                value={enSections[key] ?? ""}
                onChange={(v) => onSetEn(key, v)}
                disabled={anyPending}
                allowed={props.allowedPlaceholders[key]}
                required={props.requiredPlaceholders[key]}
              />
            ))}
          </div>
        </div>

        {/* Arabic (if bilingual) */}
        {props.bilingual && (
          <div dir="rtl">
            <h3 className="text-[14px] font-bold text-ink mb-3" dir="ltr">
              العربية
            </h3>
            <div className="space-y-3">
              <Field
                label="الموضوع"
                value={arSubject}
                onChange={setArSubject}
                disabled={anyPending}
                required
                rtl
              />
              {props.sections.map((key) => (
                <SectionField
                  key={`ar-${key}`}
                  section={key}
                  value={arSections[key] ?? ""}
                  onChange={(v) => onSetAr(key, v)}
                  disabled={anyPending}
                  allowed={props.allowedPlaceholders[key]}
                  required={props.requiredPlaceholders[key]}
                  rtl
                />
              ))}
            </div>
          </div>
        )}

        {/* Save / Reset */}
        <div className="pt-3 border-t border-line flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={anyPending}
            className="btn-primary text-[13px] disabled:opacity-40"
          >
            {pendingSave ? "Saving…" : "Save changes"}
          </button>
          {props.customized && (
            <button
              type="button"
              onClick={onReset}
              disabled={anyPending}
              className="text-[13px] text-muted hover:text-danger disabled:opacity-40"
            >
              {pendingReset ? "Resetting…" : "Reset to default"}
            </button>
          )}
        </div>

        {/* Save / reset banner */}
        {saveBanner.kind === "ok" && (
          <div className="text-[13px] text-accent-700">
            ✓ {saveBanner.message}
          </div>
        )}
        {saveBanner.kind === "issues" && (
          <ul className="text-[13px] text-danger list-disc list-inside space-y-1">
            {saveBanner.issues.map((i, idx) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        )}

        {/* Test send */}
        <div className="pt-6 border-t border-line">
          <h3 className="text-[14px] font-bold text-ink mb-1">
            Send a test email
          </h3>
          <p className="text-[12px] text-muted mb-3">
            Sends the <strong>currently edited</strong> copy (not yet
            saved) to the address below. The sign-in button in the test
            email is <strong>inert</strong> — it goes to the public
            landing page, no participant token is consumed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
            <input
              type="email"
              className="field"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="your-email@example.com"
              disabled={anyPending}
              autoComplete="off"
            />
            {props.bilingual && (
              <select
                className="field"
                value={testLang}
                onChange={(e) => setTestLang(e.target.value as "en" | "ar")}
                disabled={anyPending}
              >
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            )}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={onSendTest}
              disabled={anyPending}
              className="btn-secondary text-[13px] disabled:opacity-40"
            >
              {pendingTest ? "Sending…" : "Send test"}
            </button>
          </div>
          {testBanner.kind === "ok" && (
            <div className="mt-2 text-[13px] text-accent-700">
              ✓ {testBanner.message}
            </div>
          )}
          {testBanner.kind === "issues" && (
            <ul className="mt-2 text-[13px] text-danger list-disc list-inside space-y-1">
              {testBanner.issues.map((i, idx) => (
                <li key={idx}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* RIGHT: saved-state preview */}
      <section className="card p-6 space-y-6">
        <div>
          <h2 className="text-[15px] font-bold text-ink">Preview</h2>
          <p className="text-[12px] text-muted mt-1">
            Showing the <strong>saved</strong> copy with sample values. To
            preview unsaved edits in a real mail client, use{" "}
            <em>Send test</em> on the left.
          </p>
        </div>

        <PreviewCard label="English" preview={props.enPreview} />
        {props.arPreview && (
          <PreviewCard label="العربية" preview={props.arPreview} />
        )}
      </section>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  rtl?: boolean;
}) {
  return (
    <div>
      <label className="label" dir={props.rtl ? "rtl" : "ltr"}>
        {props.label}
        {props.required && <span className="text-danger ms-1">*</span>}
      </label>
      <input
        type="text"
        className="field"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        dir={props.rtl ? "rtl" : "ltr"}
      />
    </div>
  );
}

function SectionField(props: {
  section: SectionKey;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allowed: readonly PlaceholderToken[];
  required: readonly PlaceholderToken[];
  rtl?: boolean;
}) {
  const meta = SECTION_LABELS[props.section];
  return (
    <div>
      <label className="label" dir={props.rtl ? "rtl" : "ltr"}>
        {meta.title}
        {props.required.length > 0 && (
          <span className="text-danger ms-1">*</span>
        )}
      </label>
      <textarea
        className="field font-normal"
        rows={props.section === "cta" ? 1 : 3}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        dir={props.rtl ? "rtl" : "ltr"}
      />
      <p
        className="text-[11px] text-muted mt-1"
        dir={props.rtl ? "rtl" : "ltr"}
      >
        {meta.hint}
      </p>
    </div>
  );
}

function PreviewCard({ label, preview }: { label: string; preview: RenderedPreview }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">
          {label}
        </span>
      </div>
      <div className="bg-bgAlt rounded-md p-3 mb-2">
        <span className="text-[11px] text-muted uppercase tracking-wider me-2">
          Subject
        </span>
        <span className="text-[13px] text-ink">{preview.subject}</span>
      </div>
      <iframe
        srcDoc={`<!doctype html><html><body style="margin:0;padding:16px;background:#f5f4ef">${preview.html}</body></html>`}
        title={`Preview — ${label}`}
        sandbox=""
        className="w-full bg-white border border-line rounded-md"
        style={{ height: 480 }}
      />
    </div>
  );
}
