// lib/bulk-invite/fields.ts
//
// D97 — canonical field definitions for the bulk-invite Excel template +
// parser + preview. SINGLE SOURCE OF TRUTH for the dropdown option lists:
//   - variant / nationality / collection_mode derive from the generated DB
//     `Constants` (regenerated from the live enums — never a hand-copied
//     parallel list);
//   - language derives from the i18n `LANGUAGES` const (no DB enum exists for
//     preferred_language — see lib/i18n.ts).
// Template (template.ts), parser (parse.ts), and the preview component all
// consume THIS module, so the column set + allowed values cannot drift.
//
// CLIENT-SAFE: this module imports only plain runtime constants — no exceljs,
// no Supabase client, no server-only code — so the client preview component
// can import the shared types + option lists. The exceljs-touching code lives
// in template.ts / parse.ts (server-only).

import { Constants } from "@/lib/supabase/database.types";
import { LANGUAGES } from "@/lib/i18n";
import { EMAIL_RE } from "@/lib/email-validation";

// The 5 MAIN variants, derived from the canonical enum (NOT hardcoded). Bulk
// invite is a MAIN-phase tool (the D93/D94/D95 separation work): only main_*
// variants are invitable through it — pilots were invited individually.
export const BULK_VARIANTS: readonly string[] =
  Constants.public.Enums.questionnaire_variant.filter((v) =>
    v.startsWith("main_")
  );

export const BULK_NATIONALITIES: readonly string[] =
  Constants.public.Enums.nationality_type;

export const BULK_COLLECTION_MODES: readonly string[] =
  Constants.public.Enums.collection_mode;

export const BULK_LANGUAGES: readonly string[] = LANGUAGES;

// Per-upload row cap (counts data rows, excludes header + example). Bounds
// parse/preview work and comfortably covers the ~50-invitation main-phase
// batch with margin. Exceeding it rejects the whole upload (clear message).
export const BULK_ROW_CAP = 100;

// Sentinel email for the shipped example row. The parser SKIPS any row
// carrying this exact email, so a left-in example never becomes a candidate.
// Deterministic (we control the value) — not a fragile heuristic.
export const BULK_EXAMPLE_EMAIL = "example.delete-this-row@example.org";

export type BulkColumnKey =
  | "ref_code"
  | "recipient_name"
  | "recipient_email"
  | "variant"
  | "nationality"
  | "language"
  | "collection_mode";

export type BulkColumn = {
  key: BulkColumnKey;
  /** Header text written to row 1 (snake_case, matching the export convention). */
  header: string;
  required: boolean;
  width: number;
  /** null = free-text column; non-null = dropdown-constrained (data validation). */
  options: readonly string[] | null;
  /** Value placed in the shipped example row. */
  example: string;
  /** Header-cell note + dropdown input prompt (help text shown in Excel). */
  note: string;
};

// Column order is fixed and positional — template writes in this order, the
// parser reads by this order. (D100 — ref_code=0 (the identifier, first),
// name=1, email=2, variant=3, nationality=4, language=5, collection_mode=6.)
export const BULK_COLUMNS: readonly BulkColumn[] = [
  {
    // D100 — Sura's own tracking code per row (e.g. NGO-JOR-01). Free-text,
    // REQUIRED, must be unique (in-file + vs the DB). Replaces D98's
    // auto-generated BLK-XXXXXXXX for the bulk path.
    key: "ref_code",
    header: "ref_code",
    required: true,
    width: 16,
    options: null,
    example: "NGO-JOR-01",
    note: "Required & unique. Your tracking code — letters, digits, hyphens only (e.g. NGO-JOR-01).",
  },
  {
    key: "recipient_name",
    header: "recipient_name",
    required: true,
    width: 24,
    options: null,
    example: "Example — delete this row",
    note: "Required. Full name of the invitee.",
  },
  {
    key: "recipient_email",
    header: "recipient_email",
    required: true,
    width: 32,
    options: null,
    example: BULK_EXAMPLE_EMAIL,
    note: "Required. A valid email address.",
  },
  {
    key: "variant",
    header: "variant",
    required: true,
    width: 26,
    options: BULK_VARIANTS,
    example: "main_researchers",
    note: "Required. Pick from the dropdown — main-study variant only.",
  },
  {
    key: "nationality",
    header: "nationality",
    required: true,
    width: 16,
    options: BULK_NATIONALITIES,
    example: "not_applicable",
    note: "Required. Pick from the dropdown. Use not_applicable for non-officials.",
  },
  {
    key: "language",
    header: "language",
    required: true,
    width: 12,
    options: BULK_LANGUAGES,
    example: "en",
    note: "Required. Pick from the dropdown (en or ar).",
  },
  {
    key: "collection_mode",
    header: "collection_mode",
    required: true,
    width: 18,
    options: BULK_COLLECTION_MODES,
    example: "self_completed",
    note: "Required. Pick from the dropdown.",
  },
];

// ---- Shared validation (one source of truth for parse.ts + the D98
//      bulk-create action's server-side re-validation) ----

// Email check is the shared, tightened EMAIL_RE (lib/email-validation.ts,
// task_76dd2a4f) — one source of truth across single-invite + bulk + admin +
// test-send, so they can't drift (and comma-in-domain is now rejected).

// D100 — ref_code format. EXACTLY matches the single-invite Zod rule
// (lib/actions/invitations.ts: /^[A-Za-z0-9-]+$/, "letters, digits, and
// dashes only") so bulk + single agree, plus a sane length cap (the DB column
// is unbounded TEXT). Pilot codes like RES-JOR-01 / Sura's NGO-JOR-01 pass.
const REF_CODE_RE = /^[A-Za-z0-9-]+$/;
const REF_CODE_MAX = 64;

/** Validate one row's field values against the canonical sets + email +
 *  non-empty name + ref_code present/format (D100). Returns the list of error
 *  messages ([] = valid). Used by the upload parser (parse.ts) AND the
 *  bulk-create action's no-trust re-validation (lib/actions/bulk-invite.ts),
 *  so the two cannot diverge. PER-ROW only — the cross-row (unique-in-file)
 *  and external (unique-vs-DB) ref_code checks live in parse.ts / the action
 *  respectively, since they need all rows / a DB read. */
export function validateBulkRowValues(values: {
  refCode: string;
  recipientName: string;
  recipientEmail: string;
  variant: string;
  nationality: string;
  language: string;
  collectionMode: string;
}): string[] {
  const errors: string[] = [];
  if (!values.refCode) {
    errors.push("ref_code is required");
  } else if (!REF_CODE_RE.test(values.refCode) || values.refCode.length > REF_CODE_MAX) {
    errors.push(
      `ref_code "${values.refCode}" is invalid (letters, digits, hyphens only; max ${REF_CODE_MAX})`
    );
  }
  if (!values.recipientName) errors.push("recipient_name is required");
  if (!EMAIL_RE.test(values.recipientEmail)) {
    errors.push(`recipient_email "${values.recipientEmail}" is not a valid email`);
  }
  if (!BULK_VARIANTS.includes(values.variant)) {
    errors.push(`invalid variant "${values.variant}"`);
  }
  if (!BULK_NATIONALITIES.includes(values.nationality)) {
    errors.push(`invalid nationality "${values.nationality}"`);
  }
  if (!BULK_LANGUAGES.includes(values.language)) {
    errors.push(`invalid language "${values.language}"`);
  }
  if (!BULK_COLLECTION_MODES.includes(values.collectionMode)) {
    errors.push(`invalid collection_mode "${values.collectionMode}"`);
  }
  return errors;
}

// Category enum (category_type) — used to validate the variant→category
// derivation defensively.
const CATEGORIES: readonly string[] = ["officials", "researchers", "donors", "ngos"];

/** Derive the invitation category from a main variant slug. The slug shape is
 *  `main_<category>[_<nationality>]` (e.g. main_officials_jordanian → officials,
 *  main_researchers → researchers). Returns null if the derived segment isn't a
 *  known category (defensive — should never happen for a BULK_VARIANTS value). */
export function deriveCategoryFromVariant(variant: string): string | null {
  const seg = variant.replace(/^main_/, "").split("_")[0];
  return CATEGORIES.includes(seg) ? seg : null;
}

// ---- Shared parse / preview types (no exceljs import — client-safe) ----

export type ParsedBulkRow = {
  /** 1-based row number in the uploaded sheet (header is row 1; data ≥ 2). */
  rowNumber: number;
  refCode: string;
  recipientName: string;
  recipientEmail: string;
  variant: string;
  nationality: string;
  language: string;
  collectionMode: string;
  /** Per-row validation messages. Empty array = the row is valid. */
  errors: string[];
};

export type BulkParseResult = {
  rows: ParsedBulkRow[];
  totalDataRows: number;
  validCount: number;
  errorCount: number;
  rowCap: number;
};
