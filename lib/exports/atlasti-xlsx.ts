// lib/exports/atlasti-xlsx.ts
//
// D84 — ATLAS.ti-friendly wide-format XLSX serializer. Sister to
// lib/exports/xlsx.ts (D74 long-format), separate file so D74 stays
// byte-untouched.
//
// ─── ATLAS.ti SURVEY IMPORT CONVENTIONS (applied to headers) ─────────
//
//   !ref_code           — document name (one column with this prefix
//                          required by ATLAS Import > Survey)
//   :category           — single-value document group (one variant)
//   :nationality        — single-value document group
//   :language           — single-value document group (preferred_language)
//   :collection_mode    — single-value document group (self_completed |
//                          interview; D74 Q-C lock)
//   &submitted_at       — date column (ISO 8601 UTC Z, no millis)
//   &consent_signed_at  — date column (D84 Q-B lock)
//   Q1::<text_en>       — code column; `Q1` becomes the ATLAS code name,
//                          text after `::` is the human-readable label.
//                          Bilingual headers cap at English (D84 lock —
//                          ATLAS UI English-default; AR garbles in some
//                          Excel readers).
//   F1::<text_en>       — feedback questions follow same convention.
//   #tags               — multi-value document group, comma-separated
//                          (D84 Q-K — tags table empty today; literal
//                          comma is safe; backlog: tag-name validation).
//
// PII EXCLUSION (D84 Q-J): recipient_name + recipient_email columns are
// NOT in this shape. ATLAS analysis uses ref_code as the document
// handle; PII isn't analytical and stays in the long-format export for
// supervisor identity-cross-reference workflows.
//
// Server-side only (exceljs is a Node-runtime import; the route handler
// runs in Node).

import ExcelJS from "exceljs";
import {
  atlasQuestionHasCommentColumn,
  type AtlasExportPayload,
  type AtlasQuestion,
  type AtlasResponseRow,
} from "../repos/exports";

// Static (non-question) column order. The serializer interleaves
// payload.questions between consent_signed_at and #tags at build time.
const STATIC_PREFIX_COLUMNS = [
  { header: "!ref_code",          width: 14 },
  { header: ":category",          width: 14 },
  { header: ":nationality",       width: 14 },
  { header: ":language",          width: 10 },
  { header: ":collection_mode",   width: 18 },
  { header: "&submitted_at",      width: 22 },
  { header: "&consent_signed_at", width: 22 },
] as const;

const TAGS_COLUMN = { header: "#tags", width: 36 } as const;

/** ISO 8601 datetime with UTC Z suffix and no fractional seconds.
 *  ATLAS `&` columns expect ISO 8601; the .000Z millisecond suffix that
 *  toISOString() emits is valid but visually noisy in Excel column
 *  width. Empty input → empty cell. */
function isoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Stable column key for each question header. exceljs uses keys for
 *  programmatic row-write addressing; we keep them collision-free even
 *  if two questions share an order_index (impossible per the UNIQUE
 *  constraint, but cheap defense). */
function questionColKey(q: AtlasQuestion): string {
  return `q_${q.code}`;
}

/** D107 — column key for a choice question's comment column. */
function questionCommentColKey(q: AtlasQuestion): string {
  return `qc_${q.code}`;
}

/** Build the full ordered column spec: static prefix + question
 *  columns (in payload.questions order — order_index ASC, with feedback
 *  Q-codes after the main set per the seed convention) + #tags. D107 —
 *  a choice-with-comment question gets a `{code} comment::{textEn}` column
 *  immediately after its value column (ATLAS reads the name before `::` as
 *  the code, so the comment imports as a sibling code "Q1 comment"). */
function buildColumns(
  questions: AtlasQuestion[]
): Array<{ key: string; header: string; width: number }> {
  const cols: Array<{ key: string; header: string; width: number }> = [];
  for (const s of STATIC_PREFIX_COLUMNS) {
    cols.push({ key: s.header, header: s.header, width: s.width });
  }
  for (const q of questions) {
    cols.push({
      key: questionColKey(q),
      header: `${q.code}::${q.textEn}`,
      width: 50,
    });
    if (atlasQuestionHasCommentColumn(q)) {
      cols.push({
        key: questionCommentColKey(q),
        header: `${q.code} comment::${q.textEn}`,
        width: 40,
      });
    }
  }
  cols.push({
    key: TAGS_COLUMN.header,
    header: TAGS_COLUMN.header,
    width: TAGS_COLUMN.width,
  });
  return cols;
}

/** Per-row value map keyed by column key (matches buildColumns). */
function rowValues(
  row: AtlasResponseRow,
  questions: AtlasQuestion[]
): Record<string, string | number | boolean> {
  const v: Record<string, string | number | boolean> = {
    "!ref_code":          row.refCode,
    ":category":          row.category,
    ":nationality":       row.nationality ?? "",
    ":language":          row.preferredLanguage,
    ":collection_mode":   row.collectionMode,
    "&submitted_at":      isoDate(row.submittedAt),
    "&consent_signed_at": isoDate(row.consentSignedAt),
  };
  for (const q of questions) {
    // Empty string for unanswered question (variant-specific
    // visibility, or partial response that submitted with optional
    // gaps). ATLAS reads empty as no-answer.
    v[questionColKey(q)] = row.answers.get(q.code) ?? "";
    // D107 — the comment cell, when this question has a comment column.
    if (atlasQuestionHasCommentColumn(q)) {
      v[questionCommentColKey(q)] = row.comments.get(q.code) ?? "";
    }
  }
  // Literal comma separator (D84 Q-K). Tags table empty today; backlog
  // ticket reserves tag-name comma validation for future hardening.
  v[TAGS_COLUMN.header] = row.tags.join(",");
  return v;
}

export async function serializeAtlasXlsx(
  payload: AtlasExportPayload
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarmouk Study Admin";
  wb.created = new Date();

  // Sheet name carries the variant for at-a-glance orientation when
  // Sura opens the file in Numbers/Excel. ATLAS Survey Import reads
  // the first sheet regardless of name.
  const ws = wb.addWorksheet(payload.variant || "responses");

  const cols = buildColumns(payload.questions);
  ws.columns = cols;

  // Header row — bold. ATLAS reads row 1 as headers.
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  for (const r of payload.rows) {
    ws.addRow(rowValues(r, payload.questions));
  }

  // wrapText on every Q-column (long answers + long question labels)
  // plus #tags (comma-separated lists can grow). The static metadata
  // columns are short and stay single-line.
  for (const q of payload.questions) {
    ws.getColumn(questionColKey(q)).alignment = {
      wrapText: true,
      vertical: "top",
    };
    if (atlasQuestionHasCommentColumn(q)) {
      ws.getColumn(questionCommentColKey(q)).alignment = {
        wrapText: true,
        vertical: "top",
      };
    }
  }
  ws.getColumn(TAGS_COLUMN.header).alignment = {
    wrapText: true,
    vertical: "top",
  };

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
