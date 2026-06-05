// app/admin/(protected)/exports/download/route.ts
//
// D74 — file-delivery endpoint for the Pilot Response Export.
// GET /admin/exports/download?scope=single|bulk&format=csv|xlsx[&responseId=<uuid>]
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
// PII PAYLOADS: Cache-Control: no-store, max-age=0 on every response —
// intermediary caches must not retain decrypted name/email/answer
// content under any condition.

import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  getResponsesForExport,
  ExportDecryptFailedError,
  type ExportRow,
} from "@/lib/repos/exports";
import { serializeCsv } from "@/lib/exports/csv";
import { serializeXlsx } from "@/lib/exports/xlsx";

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
  // documented two-axis grid (scope × format).
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const format = url.searchParams.get("format");
  const responseId = url.searchParams.get("responseId");

  if (scope !== "single" && scope !== "bulk") {
    return badRequest("invalid scope");
  }
  if (format !== "csv" && format !== "xlsx") {
    return badRequest("invalid format");
  }
  if (scope === "single") {
    if (!responseId || !UUID_RE.test(responseId)) {
      return badRequest("invalid responseId");
    }
  }

  // Fetch + decrypt. Any decrypt failure raises ExportDecryptFailedError;
  // any other DB error bubbles to the generic catch.
  let rows: ExportRow[];
  try {
    rows =
      scope === "single"
        ? await getResponsesForExport(supabase, {
            scope: "single",
            responseId: responseId!,
          })
        : await getResponsesForExport(supabase, { scope: "bulk" });
  } catch (err) {
    if (err instanceof ExportDecryptFailedError) {
      try {
        await logAudit(supabase, {
          action: "export.responses.failed",
          resource: scope === "single" ? responseId! : "bulk",
          severity: "warn",
          metadata: { scope, format, errorClass: "config" },
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
    // Any other error — log a sanitized signal, audit the bucket, surface
    // a generic message. NEVER echo the error object (Postgres errors can
    // contain row data).
    console.error("[exports] route GET unexpected error errorClass=unknown");
    try {
      await logAudit(supabase, {
        action: "export.responses.failed",
        resource: scope === "single" ? responseId! : "bulk",
        severity: "warn",
        metadata: { scope, format, errorClass: "unknown" },
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
  // Bulk-scope: empty result → emit a header-only file (Q3 design call).
  if (scope === "single" && rows.length === 0) {
    return new NextResponse(
      "Response not found, not submitted, or withdrawn.",
      {
        status: 404,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }

  // Serialize. Uint8Array (not Node Buffer) so NextResponse's web BodyInit
  // type accepts the value directly; the runtime payload is identical
  // (Buffer extends Uint8Array).
  let body: string | Uint8Array;
  let contentType: string;
  if (format === "csv") {
    body = serializeCsv(rows);
    contentType = "text/csv; charset=utf-8";
  } else {
    body = await serializeXlsx(rows);
    contentType =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  // Filename. Single-scope is guaranteed non-empty here (404 above), so
  // rows[0].refCode is safe. Bulk uses a stable label regardless of count.
  const filename =
    scope === "single"
      ? singleFilename(rows[0].refCode, format)
      : bulkFilename(format);

  // Audit the SUCCESSFUL export. Ref codes are PUBLIC identifiers
  // (already on invitations_redacted + chips); they're the right
  // forensic grain. NO decrypted PII goes into metadata.
  const refCodes = Array.from(new Set(rows.map((r) => r.refCode)));
  try {
    await logAudit(supabase, {
      action: "export.responses",
      resource: scope === "single" ? responseId! : "bulk",
      severity: "info",
      metadata: {
        scope,
        format,
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
