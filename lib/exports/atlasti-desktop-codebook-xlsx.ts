// lib/exports/atlasti-desktop-codebook-xlsx.ts
//
// D86 — ATLAS.ti Desktop codebook companion xlsx. Pairs with the main
// responses workbook from lib/exports/atlasti-desktop-xlsx.ts.
//
// Empirically validated round-trip (Sura's test, 2026-06-08): ATLAS Desktop
// matches codes BY NAME on import, absorbs the comment cell into the
// existing code's "comment" field. No wizard prompts. Idempotent — re-
// importing the same codebook is silently absorbed. This is the simplest
// possible code-comment delivery for the Desktop target.
//
// ─── COLUMN SHAPE (ATLAS.ti Desktop Import Codes wizard) ─────────────
//
//   Code              — bare code name (Q1, Q2, …, F1, F4, …). MUST match
//                       the bare code column header in the responses xlsx
//                       byte-for-byte so the join lands.
//   Comment           — the long-form descriptive text shown in Code
//                       Manager. Populated with the question's English
//                       text (textEn). Bilingual EN+AR is a backlog item:
//                       AtlasQuestion currently only carries textEn (see
//                       lib/repos/exports.ts AtlasQuestion); adding textAr
//                       would require an additive repo SELECT. Out of
//                       scope for the D86 lock ("no repo change").
//   Code Group 1      — bare role label per variant ("Officials" /
//                       "Researchers" / "Donors" / "NGOs"). When Sura
//                       imports multiple variants into the same ATLAS
//                       project, each variant's codes land in their own
//                       group for at-a-glance filtering. The "Yarmouk"
//                       brand prefix is dropped (project name carries
//                       that); nationality is per-respondent and rides
//                       on :nationality in the responses file, not on
//                       the code group. ATLAS users can rename groups
//                       post-import via Code Manager if desired.
//
// ─── COMPLETENESS RULE (LOAD-BEARING) ────────────────────────────────
//
// Emits ONE ROW PER QUESTION in payload.questions — NOT one row per
// "code that exists in the current export's answers". This matters
// because nationality-gated questions (e.g. officials Q10, Syria-only)
// may be absent from every response in the current export if no Syrian
// has submitted yet. Without this rule, importing the codebook + the
// responses NOW would set comments for Q1-Q9 + Q11, then later when a
// Syrian's Q10 answer lands in the project, the Q10 code would land
// COMMENT-LESS. The fix is to seed ALL variant codes (including Q10)
// in the codebook on the first import; ATLAS happily creates "empty"
// code records that get populated by future answers, and the comment
// is already attached.
//
// Pure value-in / value-out. No Supabase client, no I/O. Same exceljs
// writer pattern as atlasti-desktop-xlsx.ts.

import ExcelJS from "exceljs";
import type { AtlasExportPayload } from "../repos/exports";

const CODE_COLUMN = { key: "code", header: "Code", width: 10 } as const;
const COMMENT_COLUMN = {
  key: "comment",
  header: "Comment",
  width: 80,
} as const;
const GROUP_COLUMN = {
  key: "group1",
  header: "Code Group 1",
  width: 24,
} as const;

/** Slug → bare role label map for the Code Group 1 cell. Sura locked
 *  these post-empirical-test 2026-06-08: drop "Yarmouk" brand prefix
 *  (ATLAS project name carries it) and drop nationality (already on
 *  :nationality in the responses file). Unknown variants fall back to
 *  the raw slug so future variant additions ship a non-empty group cell
 *  until this map is extended. */
const VARIANT_GROUP_LABEL: Record<string, string> = {
  pilot_officials: "Officials",
  pilot_researchers: "Researchers",
  pilot_donors: "Donors",
  pilot_ngos: "NGOs",
};
function groupLabelFor(variant: string): string {
  return VARIANT_GROUP_LABEL[variant] ?? variant;
}

export async function serializeAtlasDesktopCodebookXlsx(
  payload: AtlasExportPayload
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarmouk Study Admin";
  wb.created = new Date();

  // Sheet name carries the variant + a "codebook" suffix so the file is
  // self-describing when Sura opens it in Numbers/Excel before importing.
  // ATLAS Desktop Import Codes reads the first sheet regardless of name.
  const sheetName = `${payload.variant || "responses"} codebook`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName);

  ws.columns = [CODE_COLUMN, COMMENT_COLUMN, GROUP_COLUMN];

  // Header row — bold. ATLAS reads row 1 as headers.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  // One row per question (Q1..Qn, then F1..Fm — payload.questions is
  // already in order_index ASC). See "COMPLETENESS RULE" above for why
  // every variant question is emitted regardless of whether its code is
  // present in the current responses export.
  const groupLabel = groupLabelFor(payload.variant);
  for (const q of payload.questions) {
    ws.addRow({
      code: q.code,
      comment: q.textEn,
      group1: groupLabel,
    });
  }

  // wrapText on the Comment column (questions can be long, multi-line).
  ws.getColumn("comment").alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
