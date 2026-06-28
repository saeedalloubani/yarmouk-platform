// lib/exports/atlasti-csv.ts
//
// D84 — ATLAS.ti-friendly wide-format CSV serializer. Sister to
// lib/exports/csv.ts (D74 long-format), separate file so D74 stays
// byte-untouched.
//
// UTF-8 with BOM prefix (﻿) so Excel-on-Windows opens Arabic answers
// correctly (mirrors D74 csv.ts treatment). RFC 4180 quoting: any
// field containing comma, double-quote, CR, or LF is wrapped in
// double-quotes with inner quotes doubled. CRLF line endings.
//
// Column header conventions mirror atlasti-xlsx.ts verbatim. See that
// file's comment header for the ATLAS.ti Survey Import prefix mapping
// (!, :, &, ::, #).
//
// PII EXCLUSION (D84 Q-J): recipient_name + recipient_email columns
// are NOT in this shape. ref_code is the document handle.
//
// Pure value-in / value-out — no Supabase client, no I/O.

import {
  atlasQuestionHasCommentColumn,
  type AtlasExportPayload,
  type AtlasQuestion,
  type AtlasResponseRow,
} from "../repos/exports";

// Static (non-question) headers — same order + same labels as
// atlasti-xlsx.ts STATIC_PREFIX_COLUMNS. The two files should always
// drift together; if you edit one, edit the other.
const STATIC_PREFIX_HEADERS = [
  "!ref_code",
  ":category",
  ":nationality",
  ":language",
  ":collection_mode",
  "&submitted_at",
  "&consent_signed_at",
] as const;

const TAGS_HEADER = "#tags" as const;

/** ISO 8601 datetime with UTC Z suffix and no fractional seconds.
 *  Symmetric with atlasti-xlsx.ts isoDate. Empty input → empty cell. */
function isoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC 4180 quote. Identical implementation to lib/exports/csv.ts; kept
 *  separate so D74's long-format stays byte-untouched. */
function quote(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildHeaders(questions: AtlasQuestion[]): string[] {
  const out: string[] = [];
  for (const h of STATIC_PREFIX_HEADERS) out.push(h);
  for (const q of questions) {
    // Q-code + label, ATLAS `::` separator. Question text could contain
    // commas / newlines — quote() at emission time handles RFC 4180.
    out.push(`${q.code}::${q.textEn}`);
    // D107 — a choice-with-comment question's comment column, right after
    // its value column (mirrors atlasti-xlsx.ts buildColumns).
    if (atlasQuestionHasCommentColumn(q)) {
      out.push(`${q.code} comment::${q.textEn}`);
    }
  }
  out.push(TAGS_HEADER);
  return out;
}

function rowFields(
  row: AtlasResponseRow,
  questions: AtlasQuestion[]
): string[] {
  const fields: string[] = [
    row.refCode,
    row.category,
    row.nationality ?? "",
    row.preferredLanguage,
    row.collectionMode,
    isoDate(row.submittedAt),
    isoDate(row.consentSignedAt),
  ];
  for (const q of questions) {
    // Empty cell for unanswered (variant-specific visibility or
    // partial-with-optional gaps). ATLAS reads empty as no-answer.
    fields.push(row.answers.get(q.code) ?? "");
    // D107 — the comment cell (same column order as buildHeaders).
    if (atlasQuestionHasCommentColumn(q)) {
      fields.push(row.comments.get(q.code) ?? "");
    }
  }
  // Literal comma separator (D84 Q-K — tags table empty today; backlog
  // ticket reserves tag-name validation to forbid commas at apply time).
  // RFC 4180 quoting at emission still wraps the whole cell in quotes
  // if commas exist (they do), so the multi-value parse is recoverable
  // even by strict CSV readers — but ATLAS Survey Import expects raw
  // comma-separated content in #-prefix cells, which is what ATLAS itself
  // emits. Match its convention.
  fields.push(row.tags.join(","));
  return fields;
}

export function serializeAtlasCsv(payload: AtlasExportPayload): string {
  const headers = buildHeaders(payload.questions);
  const lines: string[] = [];
  lines.push(headers.map(quote).join(","));
  for (const r of payload.rows) {
    lines.push(rowFields(r, payload.questions).map(quote).join(","));
  }
  // BOM prefix is critical for Excel-on-Windows Arabic rendering.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
