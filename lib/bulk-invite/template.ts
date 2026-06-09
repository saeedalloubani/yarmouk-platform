// lib/bulk-invite/template.ts
//
// D97 — generates the downloadable bulk-invite .xlsx TEMPLATE via exceljs
// (the same lib + writeBuffer pattern the export serializers use, lib/exports/
// xlsx.ts). The constrained columns (variant, nationality, language,
// collection_mode) get a `dataValidation` of type 'list' with allowBlank:false
// + showErrorMessage, so Excel REJECTS any off-list value AT ENTRY — Sura
// cannot type an invalid enum. The option lists come from the canonical
// fields.ts (DB Constants + i18n), never a parallel copy.
//
// Server-side only — imported by the owner-gated template route handler, which
// streams the returned bytes as an .xlsx download.

import ExcelJS from "exceljs";
import { BULK_COLUMNS, BULK_ROW_CAP } from "./fields";

export async function buildBulkInviteTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarmouk Study Admin";
  // new Date() is fine in a route-handler runtime (the no-Date restriction
  // applies to Workflow scripts, not app code).
  wb.created = new Date();

  const ws = wb.addWorksheet("invitations");
  ws.columns = BULK_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // Header row — bold, with per-column help notes (hover text in Excel).
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  BULK_COLUMNS.forEach((c, i) => {
    headerRow.getCell(i + 1).note = c.note;
  });

  // Example/instructions row (row 2) — italic + grey, clearly meant to be
  // deleted. The parser skips it by sentinel email regardless, but the visual
  // cue tells Sura to remove it.
  const exampleRow = ws.addRow(
    Object.fromEntries(BULK_COLUMNS.map((c) => [c.key, c.example]))
  );
  exampleRow.font = { italic: true, color: { argb: "FF9AA0A6" } };

  // Dropdown data-validation on the constrained columns, applied to the
  // example row + every allowed data row (rows 2 .. CAP+1, since the header is
  // row 1). For an INLINE list, exceljs wants a single-element `formulae` array
  // holding a double-quote-wrapped, comma-joined string. All our values are
  // comma-free and well under Excel's 255-char inline-list limit.
  const lastDataRow = BULK_ROW_CAP + 1; // row 1 = header
  BULK_COLUMNS.forEach((c, i) => {
    if (!c.options) return;
    const formula = `"${c.options.join(",")}"`;
    for (let r = 2; r <= lastDataRow; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: "error",
        errorTitle: "Invalid value",
        error: `Pick a value from the dropdown list for "${c.header}".`,
        showInputMessage: true,
        promptTitle: c.header,
        prompt: c.note,
      };
    }
  });

  // exceljs returns a Node Buffer at runtime; Buffer extends Uint8Array, so the
  // payload is identical — typed Uint8Array because Web BodyInit excludes Node
  // Buffer (mirrors lib/exports/xlsx.ts).
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
