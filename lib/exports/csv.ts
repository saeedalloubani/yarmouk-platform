// lib/exports/csv.ts
//
// D74 — CSV serializer for the Pilot Response Export. UTF-8 with a BOM
// prefix (﻿) so Excel-on-Windows opens Arabic correctly; without it
// the file gets interpreted as Latin-1 and Arabic surfaces as mojibake.
// RFC 4180 quoting: any field containing comma, double-quote, CR, or LF
// is wrapped in double-quotes with inner double-quotes doubled. CRLF line
// endings throughout (also RFC 4180).
//
// Pure value-in / value-out — no Supabase client, no I/O. Operates on the
// ExportRow[] returned by lib/repos/exports.ts. Tested by visual rendering
// in Excel + Numbers + LibreOffice (the smoke plan in D74).

import type { ExportRow } from "../repos/exports";

const HEADERS = [
  "ref_code",
  // D95 — study/variant provenance, placed right after ref_code (the
  // row-identity block) so "which study" reads first. variant is the
  // canonical variantLabel form; questionnaire_version is the version_number.
  "variant",
  "questionnaire_version",
  "recipient_name",
  "recipient_email",
  "category",
  "nationality",
  "preferred_language",
  "collection_mode",
  "sent_at",
  "opened_at",
  "started_at",
  "submitted_at",
  "consent_signed_at",
  "question_code",
  "question_order_index",
  "is_feedback",
  "question_text_en",
  "question_text_ar",
  "answer_text",
] as const;

function quote(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowFields(r: ExportRow): string[] {
  return [
    r.refCode,
    r.variant, // D95
    String(r.questionnaireVersion), // D95
    r.recipientName,
    r.recipientEmail,
    r.category,
    r.nationality ?? "",
    r.preferredLanguage,
    r.collectionMode,
    r.sentAt ?? "",
    r.openedAt ?? "",
    r.startedAt,
    r.submittedAt,
    r.consentSignedAt ?? "",
    r.questionCode,
    String(r.questionOrderIndex),
    r.isFeedback ? "true" : "false",
    r.questionTextEn,
    r.questionTextAr,
    r.answerText,
  ];
}

export function serializeCsv(rows: ExportRow[]): string {
  const lines: string[] = [];
  lines.push(HEADERS.map(quote).join(","));
  for (const r of rows) {
    lines.push(rowFields(r).map(quote).join(","));
  }
  // BOM prefix is critical for Excel-on-Windows Arabic rendering.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
