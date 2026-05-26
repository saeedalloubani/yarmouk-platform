// lib/email/templates/types.ts
//
// D22 — type contracts for the email-template editor. Defines the
// EDITABLE BOUNDARY structurally:
//
//   - TemplateFields  →  what Sura edits per locale: a subject + named
//                        sections. Each template id has a fixed section
//                        SHAPE (declared in TEMPLATE_SPECS below); the
//                        editor renders one textarea per declared section.
//
//   - RuntimeValues   →  what the calling action passes at SEND time:
//                        plain interpolation values (name, expiry_date,
//                        ref_code) + the SYSTEM-OWNED button_href. The
//                        button_href is NEVER a placeholder inside the
//                        editable text — it's the href of a button the
//                        renderer always emits, whose LABEL is the 'cta'
//                        section. Removing the link is structurally
//                        impossible from the editor.
//
//   - TemplateSpec    →  declares per-template id: the section keys, which
//                        placeholders are allowed in body sections, and
//                        which placeholders are REQUIRED to be present
//                        (e.g. 'expiry' MUST contain {expiry_date}; if Sura
//                        deletes it, the date renders nowhere and the save
//                        is rejected).
//
// The renderer (render.ts) consumes these to validate, escape, interpolate,
// and stamp into a fixed HTML shell. The actions (lib/actions/email-
// templates.ts) consume TEMPLATE_SPECS to validate save inputs server-side.

import type { Lang } from "@/lib/i18n";

/** All editable templates wired into the editor. Stage 1 = 'invitation'
 *  only. Adding 'admin-invite' / 'submission' in Stage 2 means adding the
 *  spec here + the matching id to the email_templates.id CHECK enum. */
export type TemplateId = "invitation";

/** A single section of body copy. Each is one textarea in the editor. */
export type SectionKey =
  | "intro"
  | "cta"
  | "personal"
  | "expiry"
  | "contact";

/** Editable per-locale fields. The shape of `sections` is template-
 *  specific — the editor reads the spec to know which keys to render. */
export type TemplateFields = {
  subject: string;
  sections: Partial<Record<SectionKey, string>>;
};

/** Runtime values the action passes to the renderer at send time.
 *  button_href is SYSTEM-OWNED — not editable, not a placeholder inside
 *  any section. The renderer always emits the button with this href; the
 *  CTA section provides only the LABEL. */
export type RuntimeValues = {
  name?: string;          // optional — invitation template doesn't use {name}
  expiry_date: string;    // formatted per-locale by the caller
  ref_code: string;
  button_href: string;    // system-owned; never editable
};

/** Whitelisted placeholder tokens that may appear in body sections.
 *  Anything else in {…} fails validation. */
export type PlaceholderToken = "name" | "expiry_date" | "ref_code";

/** Per-template wiring: declares section keys, what placeholders are
 *  allowed where, and what placeholders are required where. */
export type TemplateSpec = {
  id: TemplateId;
  /** Section keys in render order. */
  sections: readonly SectionKey[];
  /** Whether the template is bilingual (both EN+AR required) or EN-only. */
  bilingual: boolean;
  /** Allowed placeholders per section. Empty array = no placeholders
   *  permitted in that section. */
  allowedPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
  /** Placeholders that MUST appear in that section. If Sura deletes one,
   *  the renderer would drop a load-bearing value (e.g. the expiry date)
   *  — save is rejected. */
  requiredPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
};

/** The single canonical spec table. */
export const TEMPLATE_SPECS: Record<TemplateId, TemplateSpec> = {
  invitation: {
    id: "invitation",
    sections: ["intro", "cta", "personal", "expiry", "contact"] as const,
    bilingual: true,
    // For the invitation template specifically: only the expiry line has
    // a placeholder. The CTA is a button LABEL (no interpolation), and
    // the others are static prose. {name} + {ref_code} are reserved for
    // future templates / future copy revisions — left out of the allow-
    // list here so Sura can't insert them in places where the renderer
    // doesn't supply them.
    allowedPlaceholders: {
      intro: [],
      cta: [],
      personal: [],
      expiry: ["expiry_date"],
      contact: [],
    },
    requiredPlaceholders: {
      intro: [],
      cta: [],
      personal: [],
      expiry: ["expiry_date"],
      contact: [],
    },
  },
};

/** A row stored in the email_templates table for ONE template id. The
 *  EN locale is always present; AR is nullable for forward compatibility
 *  with future EN-only templates. */
export type StoredTemplate = {
  id: TemplateId;
  name: string;
  description: string;
  subjectEn: string;
  subjectAr: string | null;
  sectionsEn: TemplateFields["sections"];
  sectionsAr: TemplateFields["sections"] | null;
  updatedAt: string;
  updatedBy: string | null;
};

/** Default copy bundled with the codebase, used when no DB row exists OR
 *  to fill in any section the row left blank. Defined in defaults.ts. */
export type TemplateDefaults = {
  name: string;
  description: string;
  en: { subject: string; sections: Record<SectionKey, string> };
  ar: { subject: string; sections: Record<SectionKey, string> } | null;
};

/** A fully-resolved (default-overlay-applied) template, per locale. This
 *  is what the renderer takes. */
export type ResolvedTemplate = {
  id: TemplateId;
  subject: string;
  sections: Record<SectionKey, string>;
  lang: Lang;
};

/** Just the bits of a rendered email the editor's in-page preview cares
 *  about (subject + sanitized-by-construction HTML). Plain text is not
 *  shown in-page; tests via real mail clients exist for that. */
export type RenderedPreview = {
  subject: string;
  html: string;
};
