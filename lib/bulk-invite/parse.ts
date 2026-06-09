// lib/bulk-invite/parse.ts
//
// D97 — parses + validates an uploaded bulk-invite .xlsx (in-memory; the
// caller hands an ArrayBuffer read from the request, bytes never touch disk).
// PURE value-in / value-out: no Supabase client, no I/O — operates on a buffer,
// returns a structured outcome. Validation is set-membership against the
// canonical fields.ts lists + an email regex + a non-empty-name check.
//
// Server-side only (imports exceljs). The shared result TYPES live in fields.ts
// (client-safe) so the preview component imports them without pulling exceljs.

import ExcelJS from "exceljs";
import {
  BULK_COLUMNS,
  BULK_ROW_CAP,
  BULK_EXAMPLE_EMAIL,
  validateBulkRowValues,
  type ParsedBulkRow,
  type BulkParseResult,
} from "./fields";

export type BulkParseOutcome =
  | { kind: "ok"; result: BulkParseResult }
  | { kind: "header_mismatch"; expected: string[]; got: string[] }
  | { kind: "too_many_rows"; count: number; cap: number }
  | { kind: "empty" };

// Normalize an exceljs cell value to a trimmed string. exceljs cell values can
// be string | number | boolean | Date | { text, hyperlink } (auto-linked
// emails) | { richText } | { result } (formula) | null.
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (v instanceof Date) return v.toISOString().trim();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim(); // hyperlink / rich shortcut
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[])
        .map((t) => t.text ?? "")
        .join("")
        .trim();
    }
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
  }
  return "";
}

export async function parseBulkInviteWorkbook(
  buffer: ArrayBuffer
): Promise<BulkParseOutcome> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { kind: "empty" };

  // 1. Header validation — row 1 must match the template headers exactly. A
  //    mismatch means a wrong/edited/foreign file; reject with a clear signal
  //    rather than mis-parsing columns by position.
  const expected = BULK_COLUMNS.map((c) => c.header);
  const headerRow = ws.getRow(1);
  const got = expected.map((_, i) => cellText(headerRow.getCell(i + 1).value));
  const headerOk = expected.every((h, i) => got[i] === h);
  if (!headerOk) return { kind: "header_mismatch", expected, got };

  // 2. Collect data rows: skip header, skip fully-empty rows, skip the
  //    sentinel example row (exact email match, case-insensitive).
  const emailIdx = BULK_COLUMNS.findIndex((c) => c.key === "recipient_email");
  const raws: { rowNumber: number; values: string[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const values = BULK_COLUMNS.map((_, i) => cellText(row.getCell(i + 1).value));
    if (values.every((x) => x === "")) return; // blank row
    if (values[emailIdx].toLowerCase() === BULK_EXAMPLE_EMAIL.toLowerCase()) {
      return; // left-in example row
    }
    raws.push({ rowNumber, values });
  });

  if (raws.length === 0) return { kind: "empty" };
  if (raws.length > BULK_ROW_CAP) {
    return { kind: "too_many_rows", count: raws.length, cap: BULK_ROW_CAP };
  }

  // 3. Validate each row against the canonical sets (incl. D100 ref_code
  //    present/format — per-row).
  const rows: ParsedBulkRow[] = raws.map(({ rowNumber, values }) => {
    const [
      refCode,
      recipientName,
      recipientEmail,
      variant,
      nationality,
      language,
      collectionMode,
    ] = values;
    const row = {
      refCode,
      recipientName,
      recipientEmail,
      variant,
      nationality,
      language,
      collectionMode,
    };
    return { rowNumber, ...row, errors: validateBulkRowValues(row) };
  });

  // 3b. D100 — unique-within-file ref_code check (cross-row; can't live in the
  //     per-row validator). Flag EVERY row that shares a ref_code with another.
  //     Case-sensitive to match the DB's UNIQUE constraint. (unique-vs-DB is
  //     checked in parseBulkUploadAction, which has a DB client.)
  const refCodeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.refCode) refCodeCounts.set(r.refCode, (refCodeCounts.get(r.refCode) ?? 0) + 1);
  }
  for (const r of rows) {
    if (r.refCode && (refCodeCounts.get(r.refCode) ?? 0) > 1) {
      r.errors.push(`duplicate ref_code "${r.refCode}" in file`);
    }
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return {
    kind: "ok",
    result: {
      rows,
      totalDataRows: rows.length,
      validCount,
      errorCount: rows.length - validCount,
      rowCap: BULK_ROW_CAP,
    },
  };
}
