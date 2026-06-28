// lib/exports/atlasti-desktop-xlsx.ts
//
// D86 — ATLAS.ti DESKTOP-friendly wide-format XLSX serializer.
//
// Sibling to lib/exports/atlasti-xlsx.ts (D84, Web-fallback basis). D84
// stays BYTE-UNTOUCHED — that file is the eventual ATLAS.ti Web import
// target. THIS file is the ATLAS.ti DESKTOP target, end-to-end validated
// today (3 docs, 5 groups auto-created, answer-only bodies, auto-coding
// of cells by the Q/F code in the column header).
//
// ─── DIFFERENCES vs. atlasti-xlsx.ts (D84) ───────────────────────────
//
// 1. NO `:collection_mode` column. D84 emits it as a single-value document
//    group, but ATLAS Desktop's Survey Import import wizard treats it the
//    same way as the other `:` columns — adding an extra group axis that
//    Sura's analytical workflow does not use. Dropping the column keeps
//    the post-import group set tight (category + nationality + language +
//    tags). `AtlasResponseRow.collectionMode` STAYS populated by the
//    shared repo (getResponsesForAtlasExport in lib/repos/exports.ts);
//    this serializer simply doesn't emit a column for it.
//
// 2. Question columns are BARE `Q{n}` / `F{n}` codes, NOT the D84
//    `Q{n}::${textEn}` template. ATLAS Desktop's Survey Import treats the
//    full column header text as the CODE NAME, so the suffix-after-`::`
//    landed in the code group / display label depending on version. Bare
//    codes auto-code each cell with the exact short code (Q1, Q2, …, F1,
//    …) — what Sura's manual analysis flow expects.
//
// 3. Code comments — DEFERRED. The brief flagged "emit full question text
//    as code comment" as an open empirical question (does Desktop read
//    comments from a column header at all, or is it a separate Import
//    Codes wizard?). Sura is running a 5-min test on her install. Until
//    that test resolves, this serializer emits NO comment information.
//    The seam for it is intentional: when the answer comes back, the
//    add-on is either (a) a sidecar code-comments .xlsx generated
//    alongside (Import Codes wizard input) or (b) an inline column-header
//    syntax tweak in buildColumns() below. Both are isolated diffs.
//
// ─── KEPT FROM D84 ───────────────────────────────────────────────────
//
//   !ref_code           — document name (required by Survey Import)
//   :category           — single-value document group (one per variant
//                          under Strategy 3 single-variant invariant)
//   :nationality        — single-value document group
//   :language           — single-value document group (preferred_language)
//   &submitted_at       — date column (ISO 8601 UTC Z, no millis)
//   &consent_signed_at  — date column
//   #tags               — multi-value document group, comma-separated
//
// PII EXCLUSION (Q-J posture inherited from D84 / D86 brief): no
// recipient_name + recipient_email. invitations_redacted view is the
// source. ref_code is the only identifier.
//
// Server-side only (exceljs is Node-runtime; the route handler is Node).

import ExcelJS from "exceljs";
import {
  atlasQuestionHasCommentColumn,
  type AtlasExportPayload,
  type AtlasQuestion,
  type AtlasResponseRow,
} from "../repos/exports";

// Static (non-question) column order — INTENTIONALLY excludes
// :collection_mode (D86 Q-collection_mode drop). Drift between this list
// and the D84 atlasti-xlsx.ts list is by design; do NOT consolidate
// without an explicit migration ticket (D84 is Web-fallback basis;
// header-schema drift across the three serializers is a known backlog
// item, intentionally not touched in D86's blast radius).
const STATIC_PREFIX_COLUMNS = [
  { header: "!ref_code",          width: 14 },
  { header: ":category",          width: 14 },
  { header: ":nationality",       width: 14 },
  { header: ":language",          width: 10 },
  { header: "&submitted_at",      width: 22 },
  { header: "&consent_signed_at", width: 22 },
] as const;

const TAGS_COLUMN = { header: "#tags", width: 36 } as const;

/** ISO 8601 datetime with UTC Z suffix and no fractional seconds.
 *  Sister to atlasti-xlsx.ts isoDate (identical implementation, kept
 *  local so the D84 file stays byte-untouched). Empty input → empty cell. */
function isoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Stable column key for each question header. exceljs uses keys for
 *  programmatic row-write addressing. The header value is the BARE code
 *  (`Q1`, `F2`, etc.) — see file header for why D84's `::label` suffix is
 *  not emitted here. */
function questionColKey(q: AtlasQuestion): string {
  return `q_${q.code}`;
}

/** D107 — column key for a choice question's comment column. */
function questionCommentColKey(q: AtlasQuestion): string {
  return `qc_${q.code}`;
}

/** Build the full ordered column spec: static prefix (no :collection_mode)
 *  + question columns (in payload.questions order — order_index ASC, with
 *  feedback Q-codes after the main set per seed convention) + #tags. D107 —
 *  a choice-with-comment question gets a BARE `{code} comment` column right
 *  after its value column; Desktop reads the header verbatim as the code
 *  name, so the comment imports as a sibling code "Q1 comment" (the Desktop
 *  codebook seeds a matching row — see atlasti-desktop-codebook-xlsx.ts). */
function buildColumns(
  questions: AtlasQuestion[]
): Array<{ key: string; header: string; width: number }> {
  const cols: Array<{ key: string; header: string; width: number }> = [];
  for (const s of STATIC_PREFIX_COLUMNS) {
    cols.push({ key: s.header, header: s.header, width: s.width });
  }
  for (const q of questions) {
    // BARE code. Once Sura's code-comments empirical test resolves, this
    // is the seam to extend — either by appending a documented inline
    // syntax to the header, or by leaving the header bare and emitting a
    // separate sidecar workbook. Do NOT speculatively branch here.
    cols.push({
      key: questionColKey(q),
      header: q.code,
      width: 50,
    });
    if (atlasQuestionHasCommentColumn(q)) {
      cols.push({
        key: questionCommentColKey(q),
        header: `${q.code} comment`,
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

/** Per-row value map keyed by column key (matches buildColumns).
 *  collectionMode stays available on the row object but no column emits
 *  it — by design, D86 brief lock. */
function rowValues(
  row: AtlasResponseRow,
  questions: AtlasQuestion[]
): Record<string, string | number | boolean> {
  const v: Record<string, string | number | boolean> = {
    "!ref_code":          row.refCode,
    ":category":          row.category,
    ":nationality":       row.nationality ?? "",
    ":language":          row.preferredLanguage,
    "&submitted_at":      isoDate(row.submittedAt),
    "&consent_signed_at": isoDate(row.consentSignedAt),
  };
  for (const q of questions) {
    // Empty string for unanswered (variant-specific visibility, e.g.
    // officials Q10 syrian-only — JOR respondents emit empty here, which
    // ATLAS reads as no-answer).
    v[questionColKey(q)] = row.answers.get(q.code) ?? "";
    // D107 — the comment cell, when this question has a comment column.
    if (atlasQuestionHasCommentColumn(q)) {
      v[questionCommentColKey(q)] = row.comments.get(q.code) ?? "";
    }
  }
  // Literal comma separator (D84 Q-K — tags table empty today; backlog
  // ticket reserves tag-name comma validation for future hardening).
  v[TAGS_COLUMN.header] = row.tags.join(",");
  return v;
}

export async function serializeAtlasDesktopXlsx(
  payload: AtlasExportPayload
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarmouk Study Admin";
  wb.created = new Date();

  // Sheet name carries the variant for at-a-glance orientation when Sura
  // opens the file in Numbers/Excel. ATLAS Desktop Survey Import reads
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

  // wrapText on every Q-column (long answers, possibly multi-paragraph)
  // plus #tags. The static metadata columns are short and stay
  // single-line.
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
