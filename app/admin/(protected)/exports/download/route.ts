// app/admin/(protected)/exports/download/route.ts
//
// D74 — file-delivery endpoint for the Pilot Response Export.
// D84 — Extended with a `shape` axis (long | wide) + filter params for
//       the ATLAS.ti-friendly wide-format pipeline.
//
// GET /admin/exports/download
//   ?scope=single|bulk
//   &format=csv|xlsx
//   &shape=long|wide                        (D84; default=long for
//                                            backward-compat with prior URLs)
//   &responseId=<uuid>                      (when scope=single)
//   &category=officials                     (D84; for shape=wide, EXACTLY one;
//                                            for shape=long, comma-list)
//   &nationality=jordanian,syrian           (D84; comma-list; optional)
//   &language=en,ar                         (D84; comma-list; optional)
//
// OWNER-ONLY — gate mirrors /admin/security (the page); 401 if no admin,
// 403 if a non-owner reaches the endpoint. Page-level gate is the primary
// contract; this defends against direct URL hits and any future linkage
// from a non-page surface.
//
// AUDIT WRITE ORDER — single entry per attempt: post-serialization on
// success (severity='info'), post-catch on failure (severity='warn').
// No "started" row is ever written. ExportDecryptFailedError is the
// canonical PII-decrypt failure path; we catch it, log the bucket
// (errorClass='config'), and return a safe banner — error.message is
// NEVER echoed (PII risk in unusual Vault states).
//
// D84 — wide-format pipeline DOES NOT DECRYPT (Q-J exclusion of PII
// columns). ExportDecryptFailedError can only arise on the long-format
// branch. A new AtlasMultiVariantError on the wide branch surfaces
// the Strategy 3 invariant violation (UI single-category enforcement
// is the primary protection; route-level error is defense-in-depth).
//
// PII PAYLOADS: Cache-Control: no-store, max-age=0 on every response —
// intermediary caches must not retain decrypted name/email/answer
// content under any condition (the wide path emits no PII but inherits
// the same posture for symmetry + caching-policy uniformity).

import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  getResponsesForExport,
  getResponsesForAtlasExport,
  ExportDecryptFailedError,
  AtlasMultiVariantError,
  type ExportRow,
  type AtlasExportPayload,
} from "@/lib/repos/exports";
import { serializeCsv } from "@/lib/exports/csv";
import { serializeXlsx } from "@/lib/exports/xlsx";
import { serializeAtlasCsv } from "@/lib/exports/atlasti-csv";
import { serializeAtlasXlsx } from "@/lib/exports/atlasti-xlsx";

// Allowed enum values for filter params — keep in sync with the DB
// enums (category_type, nationality_type, preferred_language CHECK).
const CATEGORIES = new Set(["officials", "researchers", "donors", "ngos"]);
const NATIONALITIES = new Set(["jordanian", "syrian", "not_applicable"]);
const LANGUAGES = new Set(["en", "ar"]);

function parseList(raw: string | null, allowed: Set<string>): string[] | null {
  if (!raw) return null;
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    if (!allowed.has(v)) return null; // signal validation failure
    out.push(v);
  }
  return out;
}

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message: string): NextResponse {
  return new NextResponse(message, {
    status: 400,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/** UTC YYYYMMDD-HHMM at download moment. Filename only — never used for
 *  sorting or storage. new Date() is fine in a Route Handler (the
 *  Workflow-script Date restriction does not apply at runtime). */
function ts(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "-" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function singleFilename(refCode: string, format: "csv" | "xlsx"): string {
  return `yarmouk-response-${refCode}-${ts()}.${format}`;
}
function bulkFilename(format: "csv" | "xlsx"): string {
  return `yarmouk-pilot-responses-long-${ts()}.${format}`;
}

// D84 — wide-format filenames carry the shape + variant so Sura can
// tell long-vs-wide and per-variant exports apart in her Downloads
// folder.
function singleAtlasFilename(
  refCode: string,
  variant: string,
  format: "csv" | "xlsx"
): string {
  return `yarmouk-atlasti-${variant}-${refCode}-${ts()}.${format}`;
}
function bulkAtlasFilename(variant: string, format: "csv" | "xlsx"): string {
  return `yarmouk-atlasti-${variant}-${ts()}.${format}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) {
    return new NextResponse(null, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
  if (admin.role !== "owner") {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // Validate query params strictly. Reject anything outside the
  // documented three-axis grid (scope × format × shape).
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const format = url.searchParams.get("format");
  const responseId = url.searchParams.get("responseId");
  // D84 — shape param defaults to "long" for backward-compat with prior
  // /admin/exports forms that don't pass it. The modal always sets it
  // explicitly.
  const shapeParam = url.searchParams.get("shape");
  const shape = shapeParam === null ? "long" : shapeParam;

  if (scope !== "single" && scope !== "bulk") {
    return badRequest("invalid scope");
  }
  if (format !== "csv" && format !== "xlsx") {
    return badRequest("invalid format");
  }
  if (shape !== "long" && shape !== "wide") {
    return badRequest("invalid shape");
  }
  if (scope === "single") {
    if (!responseId || !UUID_RE.test(responseId)) {
      return badRequest("invalid responseId");
    }
  }

  // D84 — bulk-scope filters. Parsed (and validated against enum sets)
  // for both shapes, BUT only ENFORCED on bulk scope: single-scope is
  // authoritative via responseId, so any incidental filter params are
  // ignored at the repo layer.
  const categoryRaw = url.searchParams.get("category");
  const nationalityRaw = url.searchParams.get("nationality");
  const languageRaw = url.searchParams.get("language");

  const categoryList = parseList(categoryRaw, CATEGORIES);
  if (categoryList === null) return badRequest("invalid category");
  const nationalityList = parseList(nationalityRaw, NATIONALITIES);
  if (nationalityList === null) return badRequest("invalid nationality");
  const languageList = parseList(languageRaw, LANGUAGES);
  if (languageList === null) return badRequest("invalid language");

  // D84 Strategy 3 — wide bulk requires EXACTLY one category. The
  // modal enforces single-select for wide; the route defends.
  if (shape === "wide" && scope === "bulk") {
    if (!categoryList || categoryList.length !== 1) {
      return badRequest(
        "wide-format bulk export requires exactly one category"
      );
    }
  }

  // Filter buckets for audit metadata (always logged on success/failure
  // even if empty; truthier than re-reading url.searchParams).
  const filtersForAudit: {
    category?: string[];
    nationality?: string[];
    language?: string[];
  } = {};
  if (categoryList && categoryList.length > 0)
    filtersForAudit.category = categoryList;
  if (nationalityList && nationalityList.length > 0)
    filtersForAudit.nationality = nationalityList;
  if (languageList && languageList.length > 0)
    filtersForAudit.language = languageList;

  // ── Fetch ─────────────────────────────────────────────────────────
  // Long shape uses D74 + D75 path (with PII decrypt). Wide shape uses
  // D84 new path (NO PII decrypt — recipient_name + email excluded
  // per Q-J). Same try/catch shape across branches; distinct error
  // classes per branch.
  let longRows: ExportRow[] | null = null;
  let atlasPayload: AtlasExportPayload | null = null;
  try {
    if (shape === "long") {
      longRows =
        scope === "single"
          ? await getResponsesForExport(supabase, {
              scope: "single",
              responseId: responseId!,
            })
          : await getResponsesForExport(supabase, { scope: "bulk" });
    } else {
      // shape === "wide"
      atlasPayload =
        scope === "single"
          ? await getResponsesForAtlasExport(supabase, {
              scope: "single",
              responseId: responseId!,
            })
          : await getResponsesForAtlasExport(supabase, {
              scope: "bulk",
              // Validated above: categoryList[0] is the single locked variant.
              category: categoryList![0],
              nationality: nationalityList ?? undefined,
              language: languageList ?? undefined,
            });
    }
  } catch (err) {
    // ExportDecryptFailedError — long branch only.
    if (err instanceof ExportDecryptFailedError) {
      try {
        await logAudit(supabase, {
          action: "export.responses.failed",
          resource: scope === "single" ? responseId! : "bulk",
          severity: "warn",
          metadata: {
            scope,
            format,
            shape,
            filters: filtersForAudit,
            errorClass: "config",
          },
        });
      } catch {
        // logAudit already console.error'd. Don't mask the user-facing
        // error with a secondary one.
      }
      return new NextResponse(
        "Export failed: PII decrypt error. Check admin DR documentation in RUNBOOK.",
        {
          status: 500,
          headers: { "Cache-Control": "no-store, max-age=0" },
        }
      );
    }
    // AtlasMultiVariantError — wide branch only. The UI single-category
    // enforcement should make this unreachable; route-level error is
    // defense-in-depth (e.g., crafted URL hits the endpoint directly).
    if (err instanceof AtlasMultiVariantError) {
      try {
        await logAudit(supabase, {
          action: "export.responses.failed",
          resource: scope === "single" ? responseId! : "bulk",
          severity: "warn",
          metadata: {
            scope,
            format,
            shape,
            filters: filtersForAudit,
            errorClass: "multi_variant",
            variantCount: err.variantCount,
          },
        });
      } catch {
        /* silenced */
      }
      return new NextResponse(
        "Wide-format export requires a single questionnaire variant. " +
          "Filter to one category and try again.",
        {
          status: 400,
          headers: { "Cache-Control": "no-store, max-age=0" },
        }
      );
    }
    // Any other error — log a sanitized signal, audit the bucket, surface
    // a generic message. NEVER echo the error object (Postgres errors can
    // contain row data).
    console.error("[exports] route GET unexpected error errorClass=unknown");
    try {
      await logAudit(supabase, {
        action: "export.responses.failed",
        resource: scope === "single" ? responseId! : "bulk",
        severity: "warn",
        metadata: {
          scope,
          format,
          shape,
          filters: filtersForAudit,
          errorClass: "unknown",
        },
      });
    } catch {
      /* silenced — see above */
    }
    return new NextResponse("Export failed.", {
      status: 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  // Single-scope: response not found / not submitted / withdrawn → 404.
  // Bulk-scope: empty result → emit a header-only file (Q3 design call,
  // preserved for both shapes).
  if (
    scope === "single" &&
    ((shape === "long" && (longRows ?? []).length === 0) ||
      (shape === "wide" && (atlasPayload?.rows ?? []).length === 0))
  ) {
    return new NextResponse(
      "Response not found, not submitted, or withdrawn.",
      {
        status: 404,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }

  // ── Serialize ─────────────────────────────────────────────────────
  // Uint8Array (not Node Buffer) so NextResponse's web BodyInit type
  // accepts the value directly; the runtime payload is identical
  // (Buffer extends Uint8Array).
  let body: string | Uint8Array;
  let contentType: string;
  if (shape === "long") {
    const rows = longRows ?? [];
    if (format === "csv") {
      body = serializeCsv(rows);
      contentType = "text/csv; charset=utf-8";
    } else {
      body = await serializeXlsx(rows);
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  } else {
    // shape === "wide"
    const payload = atlasPayload!;
    if (format === "csv") {
      body = serializeAtlasCsv(payload);
      contentType = "text/csv; charset=utf-8";
    } else {
      body = await serializeAtlasXlsx(payload);
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  }

  // Filename + ref_code aggregation. Long uses D74's per-row refCode
  // list; wide uses the per-row refCode list from the AtlasResponseRow
  // sequence. Single-scope is guaranteed non-empty (404 above), so the
  // first ref is safe.
  let filename: string;
  let refCodes: string[];
  if (shape === "long") {
    const rows = longRows ?? [];
    refCodes = Array.from(new Set(rows.map((r) => r.refCode)));
    filename =
      scope === "single"
        ? singleFilename(rows[0].refCode, format)
        : bulkFilename(format);
  } else {
    // shape === "wide"
    const payload = atlasPayload!;
    refCodes = Array.from(new Set(payload.rows.map((r) => r.refCode)));
    filename =
      scope === "single"
        ? singleAtlasFilename(payload.rows[0].refCode, payload.variant, format)
        : bulkAtlasFilename(payload.variant, format);
  }

  // Audit the SUCCESSFUL export. Ref codes are PUBLIC identifiers
  // (already on invitations_redacted + chips); they're the right
  // forensic grain. NO decrypted PII goes into metadata. D84 extends
  // the existing payload with `shape` + `filters` (filter values are
  // enum members, non-PII) + (for wide) `variant`.
  try {
    await logAudit(supabase, {
      action: "export.responses",
      resource: scope === "single" ? responseId! : "bulk",
      severity: "info",
      metadata: {
        scope,
        format,
        shape,
        filters: filtersForAudit,
        ...(shape === "wide" && atlasPayload
          ? { variant: atlasPayload.variant }
          : {}),
        responseCount: refCodes.length,
        refCodes,
      },
    });
  } catch {
    // logAudit already console.error'd. Do NOT block the download — the
    // user already has their data; an audit gap is loud in logs.
  }

  // `body` is `string | Uint8Array` — both are valid BodyInit at runtime,
  // but TS narrows the union to the most-restrictive arm (URLSearchParams)
  // for some BodyInit unions and complains. Cast at the boundary; the
  // runtime payload is unchanged.
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
