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
import {
  BULK_ROW_CAP,
  validateBulkRowValues,
  deriveCategoryFromVariant,
  type BulkParseResult,
} from "@/lib/bulk-invite/fields";
import { createInvitation } from "@/lib/repos/invitations";
import type {
  InvitationCategory,
  InvitationNationality,
} from "@/lib/repos/invitations";
import { variantLabel } from "@/lib/repos/questionnaires";
import { mintInvitationToken, generateAccessCode } from "@/lib/tokens";

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

// ---------------------------------------------------------------------------
// bulkCreateInvitationsAction — D98 batch-create (NO SEND)
// ---------------------------------------------------------------------------
//
// Wires the D97 confirm gate to actual row creation. For each valid row:
// mint token + access code, encrypt 4 PII values, and createInvitation with
// status='pending' + a shared batch_id + sendEmail OFF (no Resend call).
// Rows sit in 'pending' until D99's paced cron drain emails them and flips
// pending -> sent.
//
// DERIVATION (the 6 template columns -> a full invitation):
//   category              <- derived from the variant slug (main_<cat>_…)
//   questionnaireVersionId<- the ACTIVE main version for that variant
//   refCode               <- auto-generated (BLK-XXXXXXXX, retried on collision)
//   expiresAt             <- now + 30 days
//   maxUses               <- 1
//
// GRACEFUL REFUSAL (locked): a row whose variant has no ACTIVE version is
// REFUSED (clear per-row reason, NO invitation created — never points at a
// draft) and surfaced in `refused`. Per Saeed: create-the-creatable + report-
// refused (don't block ready rows because some variants aren't active yet).
//
// NO-TRUST RE-VALIDATION: the rows come from the client, so we re-run
// validateBulkRowValues server-side. Any basic-validation failure here means
// tampering or a bug (the preview gated errorCount===0), so we ABORT THE WHOLE
// batch (create nothing) — distinct from the expected active-version refusal.
//
// PII: names/emails are encrypted per row (never logged). The batch audit is
// NON-PII: batch_id + counts + variant breakdown only.

export type BulkCreateRowInput = {
  recipientName: string;
  recipientEmail: string;
  variant: string;
  nationality: string;
  language: string;
  collectionMode: string;
};

export type BulkCreateRefusal = {
  recipientEmail: string;
  variant: string;
  variantLabel: string;
  reason: string;
};

export type BulkCreateResult =
  | {
      ok: true;
      batchId: string | null; // null when nothing was created (all refused)
      createdCount: number;
      refused: BulkCreateRefusal[];
      variantBreakdown: Record<string, number>;
    }
  | {
      ok: false;
      error: "forbidden" | "empty" | "too_many_rows" | "invalid_rows" | "server";
      rowCap?: number;
      issues?: string[];
    };

const EXPIRY_DAYS = 30;

function genRefCode(): string {
  // BLK- prefix marks bulk origin; 8 hex from a v4 UUID (~4.3B space). The
  // ref_code UNIQUE constraint + the per-row retry below cover collisions.
  return "BLK-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export async function bulkCreateInvitationsAction(
  rows: BulkCreateRowInput[]
): Promise<BulkCreateResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "bulk_invite.batch_create.forbidden",
        resource: "bulk-invite",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Shape guards.
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "empty" };
  }
  if (rows.length > BULK_ROW_CAP) {
    return { ok: false, error: "too_many_rows", rowCap: BULK_ROW_CAP };
  }

  // 3. NO-TRUST re-validation. Any basic-validation failure here is tampering
  //    or a bug (the preview only enabled confirm at errorCount===0) → abort
  //    the WHOLE batch, create nothing.
  const issues: string[] = [];
  for (const r of rows) {
    const errs = validateBulkRowValues(r);
    if (errs.length) issues.push(...errs);
  }
  if (issues.length) {
    await logAudit(supabase, {
      action: "bulk_invite.batch_create.rejected",
      resource: "bulk-invite",
      severity: "warn",
      metadata: { reason: "invalid_rows", issueCount: issues.length },
    });
    return { ok: false, error: "invalid_rows", issues: issues.slice(0, 20) };
  }

  // 4. Resolve the ACTIVE version per variant (at most one per variant — the
  //    one_active_version_per_variant index). A variant absent here has no
  //    active version → its rows are refused.
  const { data: activeVersions, error: avErr } = await supabase
    .from("questionnaire_versions")
    .select("id, variant")
    .eq("status", "active");
  if (avErr) {
    console.error("[bulk-invite] active-version lookup failed", avErr);
    return { ok: false, error: "server" };
  }
  const versionByVariant = new Map<string, string>();
  for (const v of activeVersions ?? []) versionByVariant.set(v.variant, v.id);

  // 5. Partition into creatable vs refused (no active version).
  const refused: BulkCreateRefusal[] = [];
  const creatable: { row: BulkCreateRowInput; versionId: string }[] = [];
  for (const row of rows) {
    const versionId = versionByVariant.get(row.variant);
    if (!versionId) {
      refused.push({
        recipientEmail: row.recipientEmail,
        variant: row.variant,
        variantLabel: variantLabel(row.variant),
        reason: `${variantLabel(row.variant)} has no active questionnaire version yet — activate it before inviting`,
      });
      continue;
    }
    creatable.push({ row, versionId });
  }

  // Nothing creatable (every row's variant is inactive) → honest empty result.
  if (creatable.length === 0) {
    return { ok: true, batchId: null, createdCount: 0, refused, variantBreakdown: {} };
  }

  // 6. Create the creatable rows under one batch_id. status='pending',
  //    sendEmail OFF (no Resend). A per-row failure refuses that row and
  //    continues — no whole-batch abort, no partial-junk beyond what's
  //    reported.
  const batchId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const variantBreakdown: Record<string, number> = {};
  let createdCount = 0;

  for (const { row, versionId } of creatable) {
    const category = deriveCategoryFromVariant(row.variant);
    if (!category) {
      // Defensive — a BULK_VARIANTS value always derives a category.
      refused.push({
        recipientEmail: row.recipientEmail,
        variant: row.variant,
        variantLabel: variantLabel(row.variant),
        reason: "could not derive category from variant",
      });
      continue;
    }

    // Mint + encrypt (mirrors createInvitationAction; NO buildInvitationUrl —
    // we don't email here, D99 builds the URL at send time from the stored
    // encrypted token plaintext).
    const { plaintext, hash } = mintInvitationToken();
    const accessCodePlaintext = generateAccessCode();
    const { data: nameEnc, error: e1 } = await supabase.rpc("encrypt_pii", {
      p_plaintext: row.recipientName,
    });
    const { data: emailEnc, error: e2 } = await supabase.rpc("encrypt_pii", {
      p_plaintext: row.recipientEmail.toLowerCase(),
    });
    const { data: tokenEnc, error: e3 } = await supabase.rpc("encrypt_pii", {
      p_plaintext: plaintext,
    });
    const { data: accessCodeEnc, error: e4 } = await supabase.rpc("encrypt_pii", {
      p_plaintext: accessCodePlaintext,
    });
    if (e1 || e2 || e3 || e4 || !nameEnc || !emailEnc || !tokenEnc || !accessCodeEnc) {
      console.error("[bulk-invite] encrypt_pii failed for a row");
      refused.push({
        recipientEmail: row.recipientEmail,
        variant: row.variant,
        variantLabel: variantLabel(row.variant),
        reason: "could not be created (server error)",
      });
      continue;
    }

    // Insert with ref_code-collision retry (UNIQUE on ref_code → 23505).
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await createInvitation(supabase, {
          tokenHash: hash,
          tokenPlaintextEncrypted: tokenEnc,
          accessCodeEncrypted: accessCodeEnc,
          refCode: genRefCode(),
          recipientNameEncrypted: nameEnc,
          recipientEmailEncrypted: emailEnc,
          category: category as InvitationCategory,
          nationality: row.nationality as InvitationNationality,
          preferredLanguage: row.language as "en" | "ar",
          collectionMode: row.collectionMode as "self_completed" | "interview",
          questionnaireVersionId: versionId,
          expiresAt,
          maxUses: 1,
          createdBy: admin.id,
          status: "pending", // D98 — pre-send; D99's drain flips to 'sent'
          batchId,
        });
        inserted = true;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") continue; // ref_code collision — retry fresh code
        console.error("[bulk-invite] createInvitation failed for a row", code);
        break;
      }
    }
    if (inserted) {
      createdCount += 1;
      variantBreakdown[row.variant] = (variantBreakdown[row.variant] ?? 0) + 1;
    } else {
      refused.push({
        recipientEmail: row.recipientEmail,
        variant: row.variant,
        variantLabel: variantLabel(row.variant),
        reason: "could not be created (server error)",
      });
    }
  }

  // 7. Batch audit — NON-PII only: batch_id + counts + variant breakdown.
  //    One row per batch (not per invitation) to avoid flooding; batch_id
  //    ties the created rows together for forensics. Only when something was
  //    actually created.
  if (createdCount > 0) {
    await logAudit(supabase, {
      action: "bulk_invite.batch_create",
      resource: batchId,
      severity: "info",
      metadata: {
        batchId,
        created: createdCount,
        refused: refused.length,
        variantBreakdown,
      },
    });
  }

  return {
    ok: true,
    batchId: createdCount > 0 ? batchId : null,
    createdCount,
    refused,
    variantBreakdown,
  };
}
