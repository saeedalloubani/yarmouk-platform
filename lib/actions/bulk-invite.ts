"use server";

// lib/actions/bulk-invite.ts
//
// D97 — owner-only bulk-invite UPLOAD + PARSE + VALIDATE action. Returns a
// preview payload for the review screen. CREATES NOTHING AND SENDS NOTHING —
// the confirm gate in the UI is the handoff seam to D98 (which will stamp a
// batch_id, create invitations sendEmail:false, and hand the batch to the
// paced cron drain).
//
// PII discipline (mirrors lib/actions/recordings.ts):
//   - bytes stay in-memory: formData.get('file') -> File.arrayBuffer() ->
//     exceljs load. Never written to disk/temp.
//   - the parsed rows (names/emails) are returned to the OWNER's browser for
//     the preview only — same plaintext the owner types into the single-create
//     form. Never logged.
//   - AUDIT METADATA IS NON-PII: row counts only. The filename is NEVER logged
//     (a filename can carry a participant's name), nor is any cell content, nor
//     a parse error.message (it can echo cell contents).
//
// The authenticated server client is used throughout; no service-role client.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseBulkInviteWorkbook } from "@/lib/bulk-invite/parse";
import type { BulkParseResult } from "@/lib/bulk-invite/fields";

// Generous ceiling for a ≤100-row .xlsx (real files are a few KB). Guards
// against an absurd upload before we hand bytes to exceljs.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export type BulkUploadResult =
  | { ok: true; result: BulkParseResult }
  | {
      ok: false;
      error:
        | "forbidden"
        | "no_file"
        | "bad_file"
        | "empty"
        | "header_mismatch"
        | "too_many_rows";
      rowCap?: number;
      rowCount?: number;
    };

export async function parseBulkUploadAction(
  formData: FormData
): Promise<BulkUploadResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "bulk_invite.upload.forbidden",
        resource: "bulk-invite",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. File presence + size guard (never client-trusted).
  const raw = formData.get("file");
  if (!(raw instanceof File)) return { ok: false, error: "no_file" };
  if (raw.size <= 0 || raw.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "bad_file" };
  }

  // 3. Read bytes into memory (no disk) + parse.
  let buffer: ArrayBuffer;
  try {
    buffer = await raw.arrayBuffer();
  } catch (err) {
    console.error("[bulk-invite] arrayBuffer read failed", err);
    return { ok: false, error: "bad_file" };
  }

  let outcome;
  try {
    outcome = await parseBulkInviteWorkbook(buffer);
  } catch (err) {
    // NEVER log err.message — an exceljs parse error can echo cell contents.
    console.error("[bulk-invite] workbook parse failed (message suppressed)");
    void err;
    return { ok: false, error: "bad_file" };
  }

  if (outcome.kind === "header_mismatch") {
    await logAudit(supabase, {
      action: "bulk_invite.upload.rejected",
      resource: "bulk-invite",
      severity: "warn",
      metadata: { reason: "header_mismatch" },
    });
    return { ok: false, error: "header_mismatch" };
  }
  if (outcome.kind === "too_many_rows") {
    await logAudit(supabase, {
      action: "bulk_invite.upload.rejected",
      resource: "bulk-invite",
      severity: "warn",
      metadata: {
        reason: "too_many_rows",
        rowCount: outcome.count,
        rowCap: outcome.cap,
      },
    });
    return {
      ok: false,
      error: "too_many_rows",
      rowCap: outcome.cap,
      rowCount: outcome.count,
    };
  }
  if (outcome.kind === "empty") {
    return { ok: false, error: "empty" };
  }

  // 4. Success. Audit NON-PII counts only — never filename or cell contents.
  await logAudit(supabase, {
    action: "bulk_invite.upload.parsed",
    resource: "bulk-invite",
    severity: "info",
    metadata: {
      totalRows: outcome.result.totalDataRows,
      validCount: outcome.result.validCount,
      errorCount: outcome.result.errorCount,
    },
  });

  return { ok: true, result: outcome.result };
}
