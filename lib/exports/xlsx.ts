// lib/exports/xlsx.ts
//
// D74 — XLSX serializer via exceljs. Single sheet ("responses"), header
// row bold; the long-text columns (question_text_en, question_text_ar,
// answer_text) get wrapText so multi-paragraph Arabic answers render
// readably without manual column resize in Excel. UTF-8 native; no BOM
// (XLSX is unicode-safe by container format).
//
// Server-side only — exceljs is imported via the Node-runtime route
// handler. Returns a Buffer the Route Handler streams as the response
// body.

import ExcelJS from "exceljs";
import type { ExportRow } from "../repos/exports";

type ColumnSpec = {
  header: string;
  width: number;
};

const COLUMNS: ColumnSpec[] = [
  { header: "ref_code",             width: 14 },
  // D95 — variant/version provenance after ref_code (row-identity block).
  { header: "variant",              width: 26 },
  { header: "questionnaire_version", width: 8 },
  { header: "recipient_name",       width: 22 },
  { header: "recipient_email",      width: 28 },
  { header: "category",             width: 12 },
  { header: "nationality",          width: 12 },
  { header: "preferred_language",   width: 8 },
  { header: "collection_mode",      width: 16 },
  { header: "sent_at",              width: 22 },
  { header: "opened_at",            width: 22 },
  { header: "started_at",           width: 22 },
  { header: "submitted_at",         width: 22 },
  { header: "consent_signed_at",    width: 22 },
  { header: "question_code",        width: 8 },
  { header: "question_order_index", width: 6 },
  { header: "is_feedback",          width: 10 },
  { header: "question_text_en",     width: 50 },
  { header: "question_text_ar",     width: 50 },
  { header: "answer_text",          width: 60 },
];

const WRAP_TEXT_COLUMNS = [
  "question_text_en",
  "question_text_ar",
  "answer_text",
] as const;

function rowValues(r: ExportRow): Record<string, string | number | boolean> {
  return {
    ref_code:             r.refCode,
    variant:              r.variant, // D95
    questionnaire_version: r.questionnaireVersion, // D95
    recipient_name:       r.recipientName,
    recipient_email:      r.recipientEmail,
    category:             r.category,
    nationality:          r.nationality ?? "",
    preferred_language:   r.preferredLanguage,
    collection_mode:      r.collectionMode,
    sent_at:              r.sentAt ?? "",
    opened_at:            r.openedAt ?? "",
    started_at:           r.startedAt,
    submitted_at:         r.submittedAt,
    consent_signed_at:    r.consentSignedAt ?? "",
    question_code:        r.questionCode,
    question_order_index: r.questionOrderIndex,
    is_feedback:          r.isFeedback,
    question_text_en:     r.questionTextEn,
    question_text_ar:     r.questionTextAr,
    answer_text:          r.answerText,
  };
}

export async function serializeXlsx(rows: ExportRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarmouk Study Admin";
  // exceljs accepts a Date here; route handlers can use new Date() freely
  // (the no-Date-now restriction applies to Workflow scripts, not runtime).
  wb.created = new Date();

  const ws = wb.addWorksheet("responses");
  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.width,
  }));

  // Header row — bold.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  for (const r of rows) {
    ws.addRow(rowValues(r));
  }

  // wrapText on the long-text columns so multi-paragraph Arabic answers
  // render readably without manual column resize in Excel.
  for (const colKey of WRAP_TEXT_COLUMNS) {
    const col = ws.getColumn(colKey);
    col.alignment = { wrapText: true, vertical: "top" };
  }

  // writeBuffer returns an exceljs Buffer (a Node Buffer at runtime); we
  // type the return as Uint8Array because Web BodyInit (what NextResponse
  // accepts) doesn't include Node's Buffer type — but Buffer extends
  // Uint8Array, so the runtime payload is identical.
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
