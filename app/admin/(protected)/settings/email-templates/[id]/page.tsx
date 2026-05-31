// app/admin/(protected)/settings/email-templates/[id]/page.tsx
//
// D22 — owner-only editor for a single email template. Stage 1 supports
// 'invitation' only; navigating to any other id 404s for now (the
// allowlist comes from TEMPLATE_SPECS).
//
// Server-renders the SAVED-state preview (HTML + subject, per locale)
// alongside the editor. The editor itself is the client component
// EmailTemplateEditor — it owns the form state, Save / Reset / Send-test
// flows. The preview re-renders on save because the page is force-
// dynamic and the action returns ok → router.refresh().

import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
} from "@/lib/email/templates/render";
import {
  TEMPLATE_SPECS,
  type RenderedPreview,
  type TemplateId,
} from "@/lib/email/templates/types";
import EmailTemplateEditor from "@/components/EmailTemplateEditor";

export const dynamic = "force-dynamic";

const SAMPLE = {
  expiry_date_en: "15 June 2026",
  expiry_date_ar: "١٥ يونيو ٢٠٢٦",
  ref_code: "EX-001",
  name: "Dr. Example",
};

function inertButtonHref(id: TemplateId): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  // Per-template suffix mirrors the action's inert href — see
  // lib/actions/email-templates.ts inertButtonHref(). The public
  // landing page ignores all query strings.
  return `${siteUrl}/?preview=${id}-email`;
}

export default async function EmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin");

  if (!(id in TEMPLATE_SPECS)) notFound();
  const templateId = id as TemplateId;
  const spec = TEMPLATE_SPECS[templateId];

  // Look up the owner's email for the test-send default — RLS
  // admins_owner_all gates this; we're already past the owner gate above.
  const { data: ownerRow } = await supabase
    .from("admins")
    .select("email")
    .eq("id", admin.id)
    .maybeSingle();
  const ownerEmail = ownerRow?.email ?? "";

  const stored = await getTemplate(supabase, templateId);
  const defaults = getDefaults(templateId);
  const inertHref = inertButtonHref(templateId);

  // Resolved + rendered EN preview (always present).
  const enTemplate = resolveTemplate({
    templateId,
    lang: "en",
    defaultSubject: defaults.en.subject,
    defaultSections: defaults.en.sections,
    overlaySubject: stored?.subjectEn ?? null,
    overlaySections: stored?.sectionsEn ?? null,
  });
  const enRendered = renderEmailTemplate({
    template: enTemplate,
    values: {
      name: SAMPLE.name,
      expiry_date: SAMPLE.expiry_date_en,
      ref_code: SAMPLE.ref_code,
      button_href: inertHref,
    },
  });
  const enPreview: RenderedPreview = {
    subject: enRendered.subject,
    html: enRendered.html,
  };

  // Resolved + rendered AR preview (if bilingual).
  let arPreview: RenderedPreview | null = null;
  if (defaults.ar) {
    const arTemplate = resolveTemplate({
      templateId,
      lang: "ar",
      defaultSubject: defaults.ar.subject,
      defaultSections: defaults.ar.sections,
      overlaySubject: stored?.subjectAr ?? null,
      overlaySections: stored?.sectionsAr ?? null,
    });
    const r = renderEmailTemplate({
      template: arTemplate,
      values: {
        name: SAMPLE.name,
        expiry_date: SAMPLE.expiry_date_ar,
        ref_code: SAMPLE.ref_code,
        button_href: inertHref,
      },
    });
    arPreview = { subject: r.subject, html: r.html };
  }

  // Form initial state: the SAVED overlay, or — if no row — the defaults
  // pre-populated (so Sura sees the actual current copy in the textareas
  // and can edit from there).
  const initialEnSubject = stored?.subjectEn ?? defaults.en.subject;
  const initialEnSections = stored?.sectionsEn
    ? { ...defaults.en.sections, ...stored.sectionsEn }
    : { ...defaults.en.sections };
  const initialArSubject = defaults.ar
    ? stored?.subjectAr ?? defaults.ar.subject
    : null;
  const initialArSections = defaults.ar
    ? stored?.sectionsAr
      ? { ...defaults.ar.sections, ...stored.sectionsAr }
      : { ...defaults.ar.sections }
    : null;

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-6">
          <div className="eyebrow mb-1">Admin · Email templates</div>
          <h1 className="text-[24px] font-bold text-ink tracking-tight">
            {defaults.name}
          </h1>
          <p className="text-[13px] text-muted mt-1">
            {defaults.description}
          </p>
        </div>

        <EmailTemplateEditor
          templateId={templateId}
          sections={spec.sections}
          allowedPlaceholders={spec.allowedPlaceholders}
          requiredPlaceholders={spec.requiredPlaceholders}
          bilingual={spec.bilingual}
          ownerEmail={ownerEmail}
          customized={stored !== null}
          initialEnSubject={initialEnSubject}
          initialEnSections={initialEnSections}
          initialArSubject={initialArSubject}
          initialArSections={initialArSections}
          enPreview={enPreview}
          arPreview={arPreview}
        />
      </div>
    </main>
  );
}
