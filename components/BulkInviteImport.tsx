"use client";

// components/BulkInviteImport.tsx
//
// D97 — bulk-invite review UI. Upload a filled template -> parseBulkUploadAction
// (in-memory parse + validate) -> render a PREVIEW of every parsed row with
// per-row validation errors + valid/error/total counts. NOTHING is created or
// sent here: the "Send all" button is the D97->D98 HANDOFF SEAM (see onConfirm).
//
// Imports variantLabel (a pure function) for friendly variant display in the
// preview; the dropdown stored the canonical slug, which we still show in a
// monospace sub-label so Sura sees exactly what will be created.

import { useRef, useState, useTransition } from "react";
import {
  parseBulkUploadAction,
  bulkCreateInvitationsAction,
  type BulkUploadResult,
  type BulkCreateResult,
} from "@/lib/actions/bulk-invite";
import type { BulkParseResult } from "@/lib/bulk-invite/fields";
import { variantLabel } from "@/lib/repos/questionnaires";

export default function BulkInviteImport() {
  const [pending, startTransition] = useTransition();
  const [creating, startCreate] = useTransition();
  const [result, setResult] = useState<BulkParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<
    Extract<BulkCreateResult, { ok: true }> | null
  >(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setResult(null);
    setCreated(null);
    setCreateError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a filled .xlsx template first.");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await parseBulkUploadAction(fd);
      if (res.ok) setResult(res.result);
      else setError(messageFor(res));
    });
  }

  function onConfirm() {
    // D98 — create the valid rows as 'pending' invitations under one batch_id.
    // NOTHING is sent here (sendEmail OFF in the action); D99's paced cron
    // drain emails them and flips pending -> sent.
    if (creating || !result) return;
    const rows = result.rows
      .filter((r) => r.errors.length === 0)
      .map((r) => ({
        recipientName: r.recipientName,
        recipientEmail: r.recipientEmail,
        variant: r.variant,
        nationality: r.nationality,
        language: r.language,
        collectionMode: r.collectionMode,
      }));
    setCreateError(null);
    startCreate(async () => {
      const res = await bulkCreateInvitationsAction(rows);
      if (res.ok) setCreated(res);
      else setCreateError(createMessageFor(res));
    });
  }

  const allValid = !!result && result.errorCount === 0 && result.validCount > 0;

  return (
    <div className="space-y-6">
      {/* Step 1 — download */}
      <section className="card p-5">
        <h2 className="text-[15px] font-semibold text-ink mb-1">
          1. Download the template
        </h2>
        <p className="text-[13px] text-muted mb-3">
          The variant, nationality, language, and collection-mode columns are
          locked to dropdowns — Excel won&apos;t accept an invalid value. Delete
          the grey example row before filling it in.
        </p>
        <a
          href="/admin/invitations/import/template"
          className="btn-secondary text-[13px]"
          download
        >
          Download .xlsx template
        </a>
      </section>

      {/* Step 2 — upload */}
      <section className="card p-5">
        <h2 className="text-[15px] font-semibold text-ink mb-1">
          2. Upload your filled file
        </h2>
        <p className="text-[13px] text-muted mb-3">
          Up to 100 invitees per file. Nothing is created until you review and
          confirm on the next step.
        </p>
        <form onSubmit={onSubmit} className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-[13px]"
          />
          <button
            type="submit"
            disabled={pending}
            className="btn-primary text-[13px] disabled:opacity-40"
          >
            {pending ? "Reading…" : "Upload & preview"}
          </button>
        </form>
        {error && (
          <p className="text-[13px] text-danger mt-3 max-w-prose">{error}</p>
        )}
      </section>

      {/* Step 3 — preview */}
      {result && (
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold text-ink mb-3">
            3. Review
          </h2>

          <div className="flex flex-wrap gap-2 mb-4 text-[12px]">
            <span className="chip-solid bg-bgAlt text-muted-strong">
              {result.totalDataRows} row{result.totalDataRows === 1 ? "" : "s"}
            </span>
            <span className="chip-solid bg-accent-50 text-accent-700">
              {result.validCount} valid
            </span>
            <span
              className={
                "chip-solid " +
                (result.errorCount > 0
                  ? "bg-danger/10 text-danger"
                  : "bg-bgAlt text-muted")
              }
            >
              {result.errorCount} with errors
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-start text-muted border-b border-line">
                  <th className="py-1.5 pe-3 text-start font-medium">Row</th>
                  <th className="py-1.5 pe-3 text-start font-medium">Name</th>
                  <th className="py-1.5 pe-3 text-start font-medium">Email</th>
                  <th className="py-1.5 pe-3 text-start font-medium">Variant</th>
                  <th className="py-1.5 pe-3 text-start font-medium">
                    Nationality
                  </th>
                  <th className="py-1.5 pe-3 text-start font-medium">Lang</th>
                  <th className="py-1.5 pe-3 text-start font-medium">Mode</th>
                  <th className="py-1.5 text-start font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const bad = r.errors.length > 0;
                  return (
                    <tr
                      key={r.rowNumber}
                      className={
                        "border-b border-line/60 align-top " +
                        (bad ? "bg-danger/5" : "")
                      }
                    >
                      <td className="py-1.5 pe-3 mono text-muted">
                        {r.rowNumber}
                      </td>
                      <td className="py-1.5 pe-3 text-ink">{r.recipientName}</td>
                      <td className="py-1.5 pe-3 text-ink">
                        {r.recipientEmail}
                      </td>
                      <td className="py-1.5 pe-3 text-ink">
                        {variantLabel(r.variant)}
                        <span className="mono text-[10px] text-muted block">
                          {r.variant}
                        </span>
                      </td>
                      <td className="py-1.5 pe-3 text-ink">{r.nationality}</td>
                      <td className="py-1.5 pe-3 text-ink">{r.language}</td>
                      <td className="py-1.5 pe-3 text-ink">
                        {r.collectionMode}
                      </td>
                      <td className="py-1.5">
                        {bad ? (
                          <span className="text-danger">
                            {r.errors.join("; ")}
                          </span>
                        ) : (
                          <span className="text-accent-700">✓ valid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Confirm gate — creates 'pending' rows (D98); sending is D99 */}
          <div className="mt-5 pt-4 border-t border-line">
            {created ? (
              <div className="text-[13px] space-y-2 max-w-prose">
                <p className="text-accent-700">
                  ✓ {created.createdCount} invitation
                  {created.createdCount === 1 ? "" : "s"} created and queued
                  {created.batchId ? (
                    <>
                      {" "}
                      in batch{" "}
                      <span className="mono text-[11px]">
                        {created.batchId.slice(0, 8)}
                      </span>
                    </>
                  ) : null}
                  . <strong>Sending begins shortly</strong> — nothing has been
                  emailed yet.
                </p>
                {created.refused.length > 0 && (
                  <div className="notice-warn">
                    <strong>
                      {created.refused.length} row
                      {created.refused.length === 1 ? "" : "s"} not created:
                    </strong>
                    <ul className="mt-1 list-disc ms-5">
                      {created.refused.map((r, i) => (
                        <li key={i}>{r.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : result.errorCount > 0 ? (
              <p className="text-[13px] text-danger">
                Fix the {result.errorCount} flagged row
                {result.errorCount === 1 ? "" : "s"} in your file, then upload
                again. All rows must be valid before sending.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={!allValid || creating}
                  className="btn-primary text-[13px] disabled:opacity-40"
                >
                  {creating
                    ? "Creating…"
                    : `Send all (${result.validCount} invitation${
                        result.validCount === 1 ? "" : "s"
                      })`}
                </button>
                {createError && (
                  <p className="text-[13px] text-danger mt-2 max-w-prose">
                    {createError}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function messageFor(res: Extract<BulkUploadResult, { ok: false }>): string {
  switch (res.error) {
    case "forbidden":
      return "Owner-only action.";
    case "no_file":
      return "Choose a filled .xlsx template first.";
    case "bad_file":
      return "That file could not be read as an .xlsx. Re-download the template and try again.";
    case "empty":
      return "No invitee rows found. Fill in at least one row (and delete the grey example row).";
    case "header_mismatch":
      return "This file's columns don't match the template. Re-download the template and fill that copy.";
    case "too_many_rows":
      return `Too many rows: ${res.rowCount ?? "the file"} exceeds the limit of ${res.rowCap ?? 100} per upload. Split it into smaller files.`;
    default:
      return "Something went wrong. Try again.";
  }
}

function createMessageFor(
  res: Extract<BulkCreateResult, { ok: false }>
): string {
  switch (res.error) {
    case "forbidden":
      return "Owner-only action.";
    case "empty":
      return "No rows to create. Upload a filled template first.";
    case "too_many_rows":
      return `Too many rows for one batch (limit ${res.rowCap ?? 100}). Split the file.`;
    case "invalid_rows":
      return "Some rows failed re-validation on the server. Re-download the template, re-fill, and upload again.";
    default:
      return "Something went wrong creating the invitations. Try again.";
  }
}
