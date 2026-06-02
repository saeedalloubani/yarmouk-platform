"use server";

// lib/actions/email-templates.ts
//
// D22 — owner-only Server Actions for the email-template editor.
//
//   updateTemplateAction  →  validate (placeholder allowlist + required-
//                            placeholders) → upsert email_templates row →
//                            audit (template.update).
//
//   resetTemplateAction   →  delete email_templates row → audit
//                            (template.reset). Renderer falls back to
//                            defaults for every field.
//
//   previewTemplateAction →  pure-validate + render the SAVED state for
//                            the editor's in-page preview. No DB write,
//                            no email send, no audit.
//
//   sendTestEmailAction   →  validate the form state (UNSAVED) → render
//                            with INERT button_href + SAMPLE values →
//                            resend.emails.send to a destination chosen
//                            by the owner (defaults to the owner's own
//                            address) → audit (template.test_send).
//
// STRUCTURAL GUARANTEE — sendTestEmailAction creates NO real token,
// invitation, or response:
//   This file imports NONE of: lib/repos/invitations, lib/tokens,
//   encrypt_pii. There is no code path from sendTestEmailAction to
//   token-minting because the imports don't exist. The button_href
//   passed to the renderer is the static inert URL
//   `${SITE_URL}/?preview=invitation-email` — a query string the public
//   landing page silently ignores. Clicking the button in the test email
//   takes the recipient to the public landing page with no token cookie,
//   nothing consumed.
//
// Rate limit: a soft cooldown of 30s per actor (looked up via the
// audit_log) blocks accidental rapid-fire. Owner-only + audit is the
// real bound; the cooldown just keeps the surface tidy.

import { z } from "zod";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getTemplate,
  upsertTemplate,
  deleteTemplate,
} from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
  validateSections,
} from "@/lib/email/templates/render";
import {
  TEMPLATE_SPECS,
  type RenderedPreview,
} from "@/lib/email/templates/types";
import type {
  SectionKey,
  TemplateId,
} from "@/lib/email/templates/types";
import { logAudit } from "@/lib/audit";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FROM = "Yarmouk Study <noreply@karasneh-research.org>";
const REPLY_TO = "sjkarasneh24@eng.just.edu.jo";
const TEST_COOLDOWN_MS = 30_000;

// Used for test-send rendering — purely illustrative, not tied to any
// real invitation.
const SAMPLE_VALUES = {
  expiry_date_en: "15 June 2026",
  expiry_date_ar: "١٥ يونيو ٢٠٢٦",
  ref_code: "EX-001",
  name: "Dr. Example",
  // D66 — sample 6-digit code for invitation / reminder1 / reminderFinal
  // previews + test sends. The allowlist drops it for admin-invite +
  // submission, so the value is harmless there.
  access_code: "123456",
};

// ============================================================================
// Shared zod schemas
// ============================================================================

const sectionsSchema = z.record(z.string(), z.string());

const fieldsSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200, "Subject is too long"),
  sections: sectionsSchema,
});

const localeFieldsSchema = z.object({
  en: fieldsSchema,
  ar: fieldsSchema.nullable(),
});

// ============================================================================
// updateTemplateAction
// ============================================================================

export type UpdateTemplateInput = {
  id: TemplateId;
  en: { subject: string; sections: Partial<Record<SectionKey, string>> };
  ar: { subject: string; sections: Partial<Record<SectionKey, string>> } | null;
};

export type UpdateTemplateResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "validation" | "server";
      issues?: string[];
    };

export async function updateTemplateAction(
  input: UpdateTemplateInput
): Promise<UpdateTemplateResult> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "template.update.forbidden",
        resource: input.id,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 1. Shape validation.
  const parsed = localeFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  const spec = TEMPLATE_SPECS[input.id];
  if (!spec) {
    return { ok: false, error: "validation", issues: ["Unknown template id."] };
  }

  // 2. Bilingual templates require AR. (Stage 1: invitation only.)
  if (spec.bilingual && !input.ar) {
    return {
      ok: false,
      error: "validation",
      issues: ["This template requires both English and Arabic copy."],
    };
  }

  // 3. Per-locale: section presence + placeholder allowlist + required
  //    placeholders, via the shared renderer validator.
  const issues: string[] = [];
  const enResult = validateSections(spec, input.en.sections);
  if (!enResult.ok) {
    issues.push(...enResult.issues.map((i) => `English: ${i.message}`));
  }
  if (input.ar) {
    const arResult = validateSections(spec, input.ar.sections);
    if (!arResult.ok) {
      issues.push(...arResult.issues.map((i) => `Arabic: ${i.message}`));
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: "validation", issues };
  }

  // 4. Persist. Default name + description come from the bundled
  //    defaults so we don't depend on the form supplying them.
  const defaults = getDefaults(input.id);
  try {
    await upsertTemplate(supabase, {
      id: input.id,
      name: defaults.name,
      description: defaults.description,
      subjectEn: input.en.subject.trim(),
      subjectAr: input.ar ? input.ar.subject.trim() : null,
      sectionsEn: input.en.sections,
      sectionsAr: input.ar ? input.ar.sections : null,
    });
  } catch (err) {
    console.error("[templates] upsert failed", err);
    return { ok: false, error: "server" };
  }

  await logAudit(supabase, {
    action: "template.update",
    resource: input.id,
    severity: "info",
    metadata: {
      adminId: admin.id,
      sectionsEn: Object.keys(input.en.sections),
      sectionsAr: input.ar ? Object.keys(input.ar.sections) : null,
    },
  });

  return { ok: true };
}

// ============================================================================
// resetTemplateAction
// ============================================================================

export type ResetTemplateResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "server" };

export async function resetTemplateAction(
  id: TemplateId
): Promise<ResetTemplateResult> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "template.reset.forbidden",
        resource: id,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  try {
    await deleteTemplate(supabase, id);
  } catch (err) {
    console.error("[templates] reset failed", err);
    return { ok: false, error: "server" };
  }

  await logAudit(supabase, {
    action: "template.reset",
    resource: id,
    severity: "info",
    metadata: { adminId: admin.id },
  });

  return { ok: true };
}

// ============================================================================
// previewTemplateAction — render the SAVED state for the in-page preview.
// ============================================================================

export type PreviewTemplateResult =
  | { ok: true; en: RenderedPreview; ar: RenderedPreview | null }
  | { ok: false; error: "forbidden" | "server" };

export async function previewTemplateAction(
  id: TemplateId
): Promise<PreviewTemplateResult> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    return { ok: false, error: "forbidden" };
  }

  try {
    const row = await getTemplate(supabase, id);
    const defaults = getDefaults(id);
    const inertHref = inertButtonHref(id);

    const enTemplate = resolveTemplate({
      templateId: id,
      lang: "en",
      defaultSubject: defaults.en.subject,
      defaultSections: defaults.en.sections,
      overlaySubject: row?.subjectEn ?? null,
      overlaySections: row?.sectionsEn ?? null,
    });
    const enRendered = renderEmailTemplate({
      template: enTemplate,
      values: {
        name: SAMPLE_VALUES.name,
        expiry_date: SAMPLE_VALUES.expiry_date_en,
        ref_code: SAMPLE_VALUES.ref_code,
        access_code: SAMPLE_VALUES.access_code, // D66
        button_href: inertHref,
      },
    });

    let arRendered: RenderedPreview | null = null;
    if (defaults.ar) {
      const arTemplate = resolveTemplate({
        templateId: id,
        lang: "ar",
        defaultSubject: defaults.ar.subject,
        defaultSections: defaults.ar.sections,
        overlaySubject: row?.subjectAr ?? null,
        overlaySections: row?.sectionsAr ?? null,
      });
      const r = renderEmailTemplate({
        template: arTemplate,
        values: {
          name: SAMPLE_VALUES.name,
          expiry_date: SAMPLE_VALUES.expiry_date_ar,
          ref_code: SAMPLE_VALUES.ref_code,
          access_code: SAMPLE_VALUES.access_code, // D66
          button_href: inertHref,
        },
      });
      arRendered = { subject: r.subject, html: r.html };
    }

    return {
      ok: true,
      en: { subject: enRendered.subject, html: enRendered.html },
      ar: arRendered,
    };
  } catch (err) {
    console.error("[templates] preview failed", err);
    return { ok: false, error: "server" };
  }
}

// ============================================================================
// sendTestEmailAction — render the UNSAVED FORM STATE + send to a
// destination of the owner's choice. No DB write, no token, no
// invitation, no response.
// ============================================================================

export type SendTestEmailInput = {
  id: TemplateId;
  lang: "en" | "ar";
  to: string;
  en: { subject: string; sections: Partial<Record<SectionKey, string>> };
  ar: { subject: string; sections: Partial<Record<SectionKey, string>> } | null;
};

export type SendTestEmailResult =
  | { ok: true; to: string }
  | {
      ok: false;
      error: "forbidden" | "validation" | "rate_limited" | "send_failed" | "server";
      issues?: string[];
      retryAfterSeconds?: number;
    };

export async function sendTestEmailAction(
  input: SendTestEmailInput
): Promise<SendTestEmailResult> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "template.test_send.forbidden",
        resource: input.id,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 1. Destination validation.
  const toSchema = z.string().trim().toLowerCase().regex(EMAIL_RE);
  const toParsed = toSchema.safeParse(input.to);
  if (!toParsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: ["A valid destination email is required."],
    };
  }
  const to = toParsed.data;

  // 2. Shape validation + per-locale section validation. Same rules as
  //    save — what you can save, you can test; what fails save, fails test.
  const spec = TEMPLATE_SPECS[input.id];
  if (!spec) {
    return { ok: false, error: "validation", issues: ["Unknown template id."] };
  }
  if (spec.bilingual && !input.ar) {
    return {
      ok: false,
      error: "validation",
      issues: ["Bilingual template — fill English AND Arabic before testing."],
    };
  }
  if (input.lang === "ar" && !input.ar) {
    return {
      ok: false,
      error: "validation",
      issues: ["Arabic test requested but Arabic fields are empty."],
    };
  }
  if (input.lang === "en" && !input.en) {
    return {
      ok: false,
      error: "validation",
      issues: ["English test requested but English fields are empty."],
    };
  }

  const enResult = validateSections(spec, input.en.sections);
  if (!enResult.ok) {
    return {
      ok: false,
      error: "validation",
      issues: enResult.issues.map((i) => `English: ${i.message}`),
    };
  }
  if (input.ar) {
    const arResult = validateSections(spec, input.ar.sections);
    if (!arResult.ok) {
      return {
        ok: false,
        error: "validation",
        issues: arResult.issues.map((i) => `Arabic: ${i.message}`),
      };
    }
  }
  const subjectParsed = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .safeParse(input.lang === "ar" ? input.ar?.subject : input.en.subject);
  if (!subjectParsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: ["Subject is required and must be ≤ 200 characters."],
    };
  }

  // 3. Cooldown (soft rate limit). Looks up the most recent
  //    template.test_send by this admin in the audit log.
  const cooldownCheck = await checkTestSendCooldown(supabase, admin.id);
  if (cooldownCheck.cooldownActive) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: cooldownCheck.retryAfterSeconds,
    };
  }

  // 4. Resolve template from form state — defaults overlay so blank
  //    sections fall back gracefully (matches save behavior).
  const defaults = getDefaults(input.id);
  const localeDefaults = input.lang === "ar" ? defaults.ar : defaults.en;
  if (!localeDefaults) {
    return { ok: false, error: "server" };
  }
  const overlayFields = input.lang === "ar" ? input.ar : input.en;
  const template = resolveTemplate({
    templateId: input.id,
    lang: input.lang,
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: overlayFields?.subject ?? null,
    overlaySections: overlayFields?.sections ?? null,
  });

  // 5. Render. button_href is the SAFE INERT URL — clicking it takes you
  //    to the public landing page with no token consumed.
  const inertHref = inertButtonHref(input.id);
  const expiry_date =
    input.lang === "ar"
      ? SAMPLE_VALUES.expiry_date_ar
      : SAMPLE_VALUES.expiry_date_en;
  const { subject, text, html } = renderEmailTemplate({
    template,
    values: {
      name: SAMPLE_VALUES.name,
      expiry_date,
      ref_code: SAMPLE_VALUES.ref_code,
      access_code: SAMPLE_VALUES.access_code, // D66
      button_href: inertHref,
    },
  });

  // 6. Send. A "[TEST] " subject prefix makes the test unmistakable
  //    even after it lands in someone's inbox.
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[templates] RESEND_API_KEY missing for test send");
    return { ok: false, error: "server" };
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      replyTo: REPLY_TO,
      subject: `[TEST] ${subject}`,
      text: `THIS IS A TEMPLATE TEST — the button below is INERT (it goes to the public landing page; no participant token is consumed).\n\n${text}`,
      html: `<div style="background:#fff8e1;border:1px solid #ffd54f;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-family:system-ui,sans-serif;font-size:12px;color:#5d4037">THIS IS A TEMPLATE TEST — the button below is inert (it goes to the public landing page; no participant token is consumed).</div>${html}`,
    });
    if (error) {
      console.error("[templates] test send Resend error —", error.message);
      // Audit even on send failure — the attempt is the security-relevant
      // event ("Sura tried to send a test"), not the delivery success.
      await logAudit(supabase, {
        action: "template.test_send",
        resource: input.id,
        severity: "info",
        metadata: {
          adminId: admin.id,
          lang: input.lang,
          delivered: false,
        },
      });
      return { ok: false, error: "send_failed" };
    }
  } catch (err) {
    console.error("[templates] test send threw —", (err as Error).message);
    return { ok: false, error: "send_failed" };
  }

  // 7. Audit. Destination is logged because the test sends to an admin-
  //    chosen address (not a participant); useful for the "who tested
  //    what to where" audit trail. NOT the rendered body — the body
  //    contains sample data, not anything sensitive, but logging it
  //    would bloat the audit table.
  await logAudit(supabase, {
    action: "template.test_send",
    resource: input.id,
    severity: "info",
    metadata: {
      adminId: admin.id,
      lang: input.lang,
      to,
      delivered: true,
    },
  });

  return { ok: true, to };
}

// ============================================================================
// Helpers
// ============================================================================

function inertButtonHref(id: TemplateId): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  // Per-template suffix so audit-log / mail-client URL inspection can
  // distinguish which template's test was sent. The public landing page
  // ignores all query strings — verified in app/(public)/page.tsx (no
  // searchParams prop, no useSearchParams).
  return `${siteUrl}/?preview=${id}-email`;
}

async function checkTestSendCooldown(
  supabase: SupabaseClient<Database>,
  adminId: string
): Promise<{ cooldownActive: false } | { cooldownActive: true; retryAfterSeconds: number }> {
  try {
    const since = new Date(Date.now() - TEST_COOLDOWN_MS).toISOString();
    const { data, error } = await supabase
      .from("audit_log")
      .select("ts")
      .eq("action", "template.test_send")
      .eq("actor_admin_id", adminId)
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(1);
    if (error) {
      // Cooldown lookup failure → fail-open (better than blocking the test;
      // owner-only + audit are the real bounds).
      console.error("[templates] cooldown lookup failed —", error.message);
      return { cooldownActive: false };
    }
    if (data && data.length > 0) {
      const lastMs = new Date(data[0].ts).getTime();
      const elapsedMs = Date.now() - lastMs;
      const remainingMs = TEST_COOLDOWN_MS - elapsedMs;
      if (remainingMs > 0) {
        return {
          cooldownActive: true,
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        };
      }
    }
    return { cooldownActive: false };
  } catch (err) {
    console.error("[templates] cooldown threw —", (err as Error).message);
    return { cooldownActive: false };
  }
}
