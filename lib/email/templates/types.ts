// lib/email/templates/types.ts
//
// D22 + Stage 2 — type contracts for the email-template editor. Defines
// the EDITABLE BOUNDARY structurally:
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
//                        renderer always emits, whose LABEL is the
//                        spec.buttonSection (always 'cta' today).
//                        Removing the link is structurally impossible
//                        from the editor.
//
//   - TemplateSpec    →  declares per-template id: the section keys in
//                        render order, lead/fine placement around the
//                        button, which sections get email/phone link-
//                        ification, and the placeholder allow/required
//                        maps.
//
// The renderer (render.ts) consumes these to validate, escape, interpolate,
// and stamp into a fixed HTML shell. The actions (lib/actions/email-
// templates.ts) consume TEMPLATE_SPECS to validate save inputs server-side.

import type { Lang } from "@/lib/i18n";

/** All editable templates wired into the editor.
 *
 *  Stage 2 added 'admin-invite' (supervisor magic-link) and 'submission'
 *  (owner-only "a response was submitted" notification) alongside Stage
 *  1's bilingual 'invitation'.
 *
 *  D64 adds 'reminder1' + 'reminderFinal' — the two auto-nudge reminders
 *  dispatched by /api/cron/send-reminders at ~7d and ~14d after the
 *  invitation goes out. Both are bilingual and structurally identical to
 *  'invitation' (same sections, same placement, same linkify, same
 *  placeholder allowlist) — only the body copy differs. Their specs are
 *  duplicated rather than factored: each template stands alone in the
 *  editor and on the wire, so Sura can edit them independently without
 *  cross-coupling. The mixed-case 'reminderFinal' id matches the
 *  email_templates.id CHECK enum declared in 20260519170002_tables.sql;
 *  see 20260601130001_invitations_reminders_and_send_failure.sql header
 *  for the snake-vs-camel naming note. */
export type TemplateId =
  | "invitation"
  | "reminder1"
  | "reminderFinal"
  | "admin-invite"
  | "submission";

/** A single section of body copy. Each is one textarea in the editor.
 *  The set is the UNION across all templates; each TemplateSpec
 *  declares the subset it uses in its `sections` array. */
export type SectionKey =
  | "intro"     // invitation, admin-invite — opening paragraph above the button
  | "cta"       // ALL — button LABEL (the URL is system-owned)
  | "personal"  // invitation — "this link is personal" reminder
  | "expiry"    // invitation — expiry date line
  | "contact"   // invitation, admin-invite — closing reply-to line (auto-linkified)
  | "greeting"  // admin-invite — "Hello {name}," opener
  | "notice"    // admin-invite — fine print under the button
  | "lead";     // submission — single body paragraph

/** Editable per-locale fields. The shape of `sections` is template-
 *  specific — the editor reads the spec to know which keys to render. */
export type TemplateFields = {
  subject: string;
  sections: Partial<Record<SectionKey, string>>;
};

/** Runtime values the action passes to the renderer at send time.
 *  button_href is SYSTEM-OWNED — not editable, not a placeholder inside
 *  any section. The renderer always emits the button with this href;
 *  the spec.buttonSection (always 'cta' today) provides only the LABEL.
 *
 *  Unused fields per template — for uniformity the struct shape stays
 *  constant; the per-section allowlist is what actually constrains
 *  which placeholders get substituted in body text:
 *    - invitation         → uses expiry_date.   name/ref_code unused.
 *    - admin-invite       → uses name.          expiry_date/ref_code unused.
 *    - submission         → uses ref_code.      name/expiry_date unused.
 *  Callers pass "" for unused string fields. */
export type RuntimeValues = {
  name?: string;
  expiry_date: string;
  ref_code: string;
  button_href: string;     // system-owned; never editable
};

/** Whitelisted placeholder tokens that may appear in body sections.
 *  Anything else in {…} fails validation. */
export type PlaceholderToken = "name" | "expiry_date" | "ref_code";

/** Where a section sits relative to the button:
 *    - 'lead' = above the button (no divider between)
 *    - 'fine' = below the button, after a divider
 *  The buttonSection itself is marked 'lead' — the button is rendered
 *  at the end of the lead block. If a spec declares NO 'fine' sections,
 *  the renderer omits the divider entirely (submission). */
export type SectionPlacement = "lead" | "fine";

/** Per-template wiring: section keys + layout + allowlists. */
export type TemplateSpec = {
  id: TemplateId;
  /** Section keys in render order, partitioned at render time by
   *  `placement` into a lead block (above button) and a fine block
   *  (below divider). */
  sections: readonly SectionKey[];
  /** Whether the template is bilingual (both EN+AR required) or EN-only. */
  bilingual: boolean;
  /** Which section provides the button LABEL. Always present in
   *  `sections`. Always 'cta' today. */
  buttonSection: SectionKey;
  /** Placement of each section relative to the button. Stub entries
   *  for sections this spec doesn't declare are tolerated — the
   *  renderer only consults `placement[k]` for `k` in `sections`. */
  placement: Record<SectionKey, SectionPlacement>;
  /** Sections to run email/phone linkification on. Empty = none.
   *  Only the 'contact' section qualifies today (invitation + admin-
   *  invite). */
  linkify: readonly SectionKey[];
  /** Allowed placeholders per section. Empty array = no placeholders
   *  permitted in that section. Stub entries for sections this spec
   *  doesn't declare are ignored (validator only walks `spec.sections`). */
  allowedPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
  /** Placeholders that MUST appear in that section. If Sura deletes
   *  one, the renderer would drop a load-bearing value (e.g. the
   *  expiry date) — save is rejected. */
  requiredPlaceholders: Record<SectionKey, readonly PlaceholderToken[]>;
};

// All 8 section keys, listed once — used for the stub entries below so
// every TemplateSpec satisfies the Record<SectionKey, …> type without
// repeating the union in eight places per spec.
const ALL_SECTIONS: readonly SectionKey[] = [
  "intro",
  "cta",
  "personal",
  "expiry",
  "contact",
  "greeting",
  "notice",
  "lead",
];

/** Fill a Record<SectionKey, T> with the same default value, then
 *  overlay any per-key overrides. Used to keep the spec literals
 *  readable while still satisfying the full-record type. */
function fillSectionRecord<T>(
  fill: T,
  overrides: Partial<Record<SectionKey, T>>
): Record<SectionKey, T> {
  const out = {} as Record<SectionKey, T>;
  for (const k of ALL_SECTIONS) out[k] = fill;
  return { ...out, ...overrides };
}

/** The single canonical spec table. */
export const TEMPLATE_SPECS: Record<TemplateId, TemplateSpec> = {
  invitation: {
    id: "invitation",
    sections: ["intro", "cta", "personal", "expiry", "contact"] as const,
    bilingual: true,
    buttonSection: "cta",
    placement: fillSectionRecord<SectionPlacement>("fine", {
      intro: "lead",
      cta: "lead",
      personal: "fine",
      expiry: "fine",
      contact: "fine",
    }),
    linkify: ["contact"],
    allowedPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
    requiredPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
  },
  // D64 — reminder1 + reminderFinal. Byte-identical to invitation except
  // for the id field. The duplication is intentional: each reminder is a
  // first-class template in the editor and the DB, with its own copy and
  // its own audit trail. No factoring.
  reminder1: {
    id: "reminder1",
    sections: ["intro", "cta", "personal", "expiry", "contact"] as const,
    bilingual: true,
    buttonSection: "cta",
    placement: fillSectionRecord<SectionPlacement>("fine", {
      intro: "lead",
      cta: "lead",
      personal: "fine",
      expiry: "fine",
      contact: "fine",
    }),
    linkify: ["contact"],
    allowedPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
    requiredPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
  },
  reminderFinal: {
    id: "reminderFinal",
    sections: ["intro", "cta", "personal", "expiry", "contact"] as const,
    bilingual: true,
    buttonSection: "cta",
    placement: fillSectionRecord<SectionPlacement>("fine", {
      intro: "lead",
      cta: "lead",
      personal: "fine",
      expiry: "fine",
      contact: "fine",
    }),
    linkify: ["contact"],
    allowedPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
    requiredPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      expiry: ["expiry_date"],
    }),
  },
  "admin-invite": {
    id: "admin-invite",
    sections: ["greeting", "intro", "cta", "notice", "contact"] as const,
    bilingual: false,
    buttonSection: "cta",
    placement: fillSectionRecord<SectionPlacement>("fine", {
      greeting: "lead",
      intro: "lead",
      cta: "lead",
      notice: "fine",
      contact: "fine",
    }),
    linkify: ["contact"],
    allowedPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      greeting: ["name"],
    }),
    requiredPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      greeting: ["name"],
    }),
  },
  submission: {
    id: "submission",
    sections: ["lead", "cta"] as const,
    bilingual: false,
    buttonSection: "cta",
    placement: fillSectionRecord<SectionPlacement>("lead", {
      lead: "lead",
      cta: "lead",
    }),
    linkify: [], // intentionally empty — no contact line in this template
    allowedPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      lead: ["ref_code"],
    }),
    requiredPlaceholders: fillSectionRecord<readonly PlaceholderToken[]>([], {
      lead: ["ref_code"],
    }),
  },
};

/** A row stored in the email_templates table for ONE template id. The
 *  EN locale is always present; AR is nullable for EN-only templates
 *  (admin-invite, submission). */
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
 *  to fill in any section the row left blank. Defined in defaults.ts.
 *  `sections` is Partial: each template carries only the keys its spec
 *  declares (e.g. submission's defaults only have lead + cta). */
export type TemplateDefaults = {
  name: string;
  description: string;
  en: { subject: string; sections: Partial<Record<SectionKey, string>> };
  ar: { subject: string; sections: Partial<Record<SectionKey, string>> } | null;
};

/** A fully-resolved (default-overlay-applied) template, per locale.
 *  This is what the renderer takes. Like TemplateDefaults.sections,
 *  the map is Partial — only the keys the template's spec declares
 *  are populated; the renderer iterates `spec.sections` rather than
 *  this map's keys. */
export type ResolvedTemplate = {
  id: TemplateId;
  subject: string;
  sections: Partial<Record<SectionKey, string>>;
  lang: Lang;
};

/** Just the bits of a rendered email the editor's in-page preview cares
 *  about (subject + sanitized-by-construction HTML). Plain text is not
 *  shown in-page; tests via real mail clients exist for that. */
export type RenderedPreview = {
  subject: string;
  html: string;
};
