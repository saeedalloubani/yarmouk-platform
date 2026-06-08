// lib/repos/invitations.ts
//
// Data access for the `invitations` table.
//   - Owner reads     → base table (full encrypted PII columns)
//   - Read-only reads → `invitations_redacted` view (PII columns are NULL,
//                       token_hash entirely omitted from the view)
//   - All writes      → base table (RLS rejects from any non-Owner caller)
//
// Pages, Server Actions, and route handlers MUST go through this repo
// instead of calling `supabase.from('invitations')` directly.
// See lib/repos/README.md and docs/DECISIONS.md → D31.
//
// `token_hash` is never returned from this repo, even to Owner. We
// `.select("*")` on the base for simplicity, but the mapper drops the
// hash on the way out — the Invitation type doesn't have it, so callers
// can't accidentally surface it.
//
// Implementation note: each read branches on the role inline and calls
// `supabase.from(literal)` with a string literal. Passing a union string
// to from() collapses the resulting row type (TS infers the intersection
// of column names across all schema tables). Inline branching keeps each
// query strongly typed.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { getCurrentAdminRole } from "../auth";

type DbRow = Database["public"]["Tables"]["invitations"]["Row"];
type DbViewRow = Database["public"]["Views"]["invitations_redacted"]["Row"];
type DbInsert = Database["public"]["Tables"]["invitations"]["Insert"];
type DbUpdate = Database["public"]["Tables"]["invitations"]["Update"];

export type InvitationCategory = "officials" | "researchers" | "donors" | "ngos";

// Display-only label for a category. Title-casing handles three of the
// four; "ngos" is the acronym exception ("NGOs", not "Ngos"). Does NOT
// touch the stored enum value — purely how the label renders.
export function categoryLabel(category: string): string {
  if (category === "ngos") return "NGOs";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// Display-only label for a collection mode. Stored value is the snake_case
// enum; this is purely how it renders.
export function collectionModeLabel(mode: string): string {
  return mode === "interview" ? "Interview" : "Self-completed";
}
export type InvitationNationality =
  | "jordanian"
  | "syrian"
  | "not_applicable";
export type InvitationStatusValue =
  | "sent"
  | "opened"
  | "started"
  | "submitted"
  | "expired"
  // Terminal owner-driven kill — set by revokeInvitationAction alongside
  // token_hash rotation + is_locked=TRUE on any in-progress response.
  // See migration 20260527130001_invitation_status_revoked.sql and
  // lib/actions/invitations.ts revokeInvitationAction.
  | "revoked";

export type InvitationCollectionMode = "self_completed" | "interview";

export type Invitation = {
  id: string;
  refCode: string;
  /** NULL when the caller is a read-only admin (view masks the column). */
  recipientNameEncrypted: string | null;
  /** NULL when the caller is a read-only admin (view masks the column). */
  recipientEmailEncrypted: string | null;
  category: InvitationCategory;
  nationality: InvitationNationality | null;
  /** D58 added the base column ('self_completed' | 'interview', NOT NULL
   *  DEFAULT 'self_completed'); D69 surfaced it in invitations_redacted, so
   *  readonly admins now see it too. Operational classification (NOT PII).
   *  Inherited by response via the invitation FK — there is deliberately no
   *  collection_mode column on responses (see D60). */
  collectionMode: InvitationCollectionMode;
  preferredLanguage: "en" | "ar";
  questionnaireVersionId: string;
  status: InvitationStatusValue;
  expiresAt: string;
  useCount: number;
  maxUses: number;
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** D64 — set when a Resend send fails for this row (createInvitation,
   *  resendInvitation, or cron reminder); cleared (NULL) on the next ok
   *  send from the same row. Drives the "send failed" chip on
   *  /admin/invitations. Surfaced via invitations_redacted to both owner
   *  and readonly admins (operational, non-PII). */
  lastSendFailedAt: string | null;
  /** D66 — set by validate_invitation_code to NOW() on a FRESH CLAIM via
   *  /enter (not on resumption). Forensic timestamp: "when /enter first
   *  fresh-claimed this invitation." Not a behavior gate. Surfaced via
   *  invitations_redacted to both owner and readonly admins (operational,
   *  non-PII). NULL until first /enter fresh-claim. */
  accessCodeUsedAt: string | null;
};

function rowToInvitation(row: DbRow | DbViewRow): Invitation {
  // PG view metadata doesn't carry NOT NULL info, so generated DbViewRow
  // types every column as nullable. At runtime the view returns base-table
  // values verbatim for non-redacted columns. We cast to DbRow to recover
  // the schema's actual non-null guarantees. PII columns
  // (recipient_*_encrypted) are intentionally NULL in the view, so accessed
  // via the original `row` reference where the union nullability is honest.
  // preferred_language is narrowed via `as 'en' | 'ar'` because the DB
  // CHECK constraint enforces this but gen types don't reflect CHECK.
  // token_hash exists on DbRow but is intentionally not surfaced here.
  const r = row as DbRow;
  return {
    id: r.id,
    refCode: r.ref_code,
    recipientNameEncrypted: row.recipient_name_encrypted,
    recipientEmailEncrypted: row.recipient_email_encrypted,
    category: r.category,
    nationality: r.nationality,
    collectionMode: r.collection_mode,
    preferredLanguage: r.preferred_language as "en" | "ar",
    questionnaireVersionId: r.questionnaire_version_id,
    status: r.status,
    expiresAt: r.expires_at,
    useCount: r.use_count,
    maxUses: r.max_uses,
    sentAt: r.sent_at,
    openedAt: r.opened_at,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastSendFailedAt: r.last_send_failed_at,
    accessCodeUsedAt: r.access_code_used_at, // D66
  };
}

// ---------- Reads ----------

/** Get a single invitation by id. Returns null if not found. */
export async function getInvitation(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Invitation | null> {
  const role = await getCurrentAdminRole(supabase);
  if (role === "owner") {
    const { data, error } = await supabase
      .from("invitations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToInvitation(data) : null;
  }
  const { data, error } = await supabase
    .from("invitations_redacted")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToInvitation(data) : null;
}

export type ListInvitationsFilter = {
  status?: InvitationStatusValue;
  category?: InvitationCategory;
  nationality?: InvitationNationality;
  /** Single-version filter (legacy; applied as `.eq`). */
  questionnaireVersionId?: string;
  /**
   * D94 — pilot/main SCOPE filter: a SET of questionnaire_version_ids,
   * applied as `.in("questionnaire_version_id", …)`. Additive (composes
   * with status / category / nationality via AND). The caller resolves
   * the set from questionnaire_versions.type via lib/repos/scope.ts
   * (same mechanism as D93's dashboard scope). Omitted / undefined → no
   * version filter (the "All" scope). An empty array matches zero rows —
   * the honest empty render for a scope with no versions yet.
   */
  questionnaireVersionIds?: string[];
  limit?: number;
  offset?: number;
};

/** List invitations (newest first), with optional filters. */
export async function listInvitations(
  supabase: SupabaseClient<Database>,
  filter: ListInvitationsFilter = {}
): Promise<Invitation[]> {
  const role = await getCurrentAdminRole(supabase);

  const limit = filter.limit ?? undefined;
  const offset = filter.offset ?? 0;
  const rangeFrom = offset;
  const rangeTo = limit !== undefined ? offset + limit - 1 : offset + 999;
  const useRange = limit !== undefined || offset > 0;

  if (role === "owner") {
    let q = supabase
      .from("invitations")
      .select("*")
      .order("created_at", { ascending: false });
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.category) q = q.eq("category", filter.category);
    if (filter.nationality !== undefined)
      q = q.eq("nationality", filter.nationality);
    if (filter.questionnaireVersionId)
      q = q.eq("questionnaire_version_id", filter.questionnaireVersionId);
    // D94 — pilot/main scope set. null/undefined skips; array (incl.
    // empty) restricts. Non-PII column; present on the base table.
    if (filter.questionnaireVersionIds !== undefined)
      q = q.in("questionnaire_version_id", filter.questionnaireVersionIds);
    if (useRange) q = q.range(rangeFrom, rangeTo);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(rowToInvitation);
  }

  let q = supabase
    .from("invitations_redacted")
    .select("*")
    .order("created_at", { ascending: false });
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.category) q = q.eq("category", filter.category);
  if (filter.nationality !== undefined)
    q = q.eq("nationality", filter.nationality);
  if (filter.questionnaireVersionId)
    q = q.eq("questionnaire_version_id", filter.questionnaireVersionId);
  // D94 — pilot/main scope set (readonly branch; the redacted view also
  // carries the non-PII questionnaire_version_id column).
  if (filter.questionnaireVersionIds !== undefined)
    q = q.in("questionnaire_version_id", filter.questionnaireVersionIds);
  if (useRange) q = q.range(rangeFrom, rangeTo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToInvitation);
}

// ---------- Writes (Owner only — RLS rejects others) ----------

export type CreateInvitationInput = {
  /**
   * SHA-256 hex hash of the plaintext URL token. The caller (typically a
   * Session 3 Server Action) generates plaintext + hashes it; plaintext
   * goes into the outbound email, only the hash is stored here.
   */
  tokenHash: string;
  /**
   * D64 — Vault-encrypted plaintext token (encrypted via encrypt_pii by
   * the caller). Stored alongside token_hash so the reminder cron (D64
   * STEP 7) can decrypt + reuse the same URL without rotating the token.
   * Path B locked: reminders reuse, don't rotate.
   */
  tokenPlaintextEncrypted: string;
  /**
   * D66 — Vault-encrypted 6-digit participant access code (encrypted via
   * encrypt_pii by the caller). Stored so:
   *   (a) validate_invitation_code can brute-decrypt-scan the candidate
   *       set when a recipient types the code at /enter.
   *   (b) The reminder cron can decrypt + include the same code in
   *       reminder1 and reminderFinal bodies (URL-prefetch fallback
   *       parity with the URL plaintext).
   * NEVER logged, NEVER in audit metadata. Pre-D66 invitations don't
   * have this column populated; the cron + RPC candidate filters
   * silently exclude rows where access_code_encrypted IS NULL.
   */
  accessCodeEncrypted: string;
  refCode: string;
  /** Already pgcrypto-encrypted by lib/encryption.ts (Session 2b). */
  recipientNameEncrypted: string;
  /** Already pgcrypto-encrypted by lib/encryption.ts (Session 2b). */
  recipientEmailEncrypted: string;
  category: InvitationCategory;
  nationality?: InvitationNationality | null;
  collectionMode?: InvitationCollectionMode;
  preferredLanguage?: "en" | "ar";
  questionnaireVersionId: string;
  expiresAt: string;
  maxUses?: number;
  createdBy?: string | null;
};

/** Create an invitation. Writes always target the base table. */
export async function createInvitation(
  supabase: SupabaseClient<Database>,
  input: CreateInvitationInput
): Promise<Invitation> {
  const insert: DbInsert = {
    token_hash: input.tokenHash,
    token_plaintext_encrypted: input.tokenPlaintextEncrypted,
    access_code_encrypted: input.accessCodeEncrypted, // D66
    ref_code: input.refCode,
    recipient_name_encrypted: input.recipientNameEncrypted,
    recipient_email_encrypted: input.recipientEmailEncrypted,
    category: input.category,
    nationality: input.nationality ?? null,
    collection_mode: input.collectionMode ?? "self_completed",
    preferred_language: input.preferredLanguage ?? "en",
    questionnaire_version_id: input.questionnaireVersionId,
    expires_at: input.expiresAt,
    max_uses: input.maxUses ?? 1,
    created_by: input.createdBy ?? null,
  };
  const { data, error } = await supabase
    .from("invitations")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return rowToInvitation(data);
}

export type UpdateInvitationInput = Partial<{
  /** Use this to rotate the link (resend flow). New hash, old hash discarded. */
  tokenHash: string;
  /**
   * D64 — must be supplied together with `tokenHash` on every rotation
   * (resend) so the encrypted plaintext stays in sync with token_hash.
   * Pass `null` on revoke to clear (the new revoke hash has no
   * recoverable plaintext; nulling avoids orphan ciphertext pointing at
   * a dead hash). NOT touched on every UPDATE — only on rotation /
   * revoke paths. The reminder cron (D64 STEP 7) doesn't write this
   * column at all (Path B locked: reminders reuse, don't rotate).
   */
  tokenPlaintextEncrypted: string | null;
  status: InvitationStatusValue;
  expiresAt: string;
  maxUses: number;
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  useCount: number;
  /** D64 — pass an ISO string to stamp the row as send-failed, or null
   *  to clear (on a subsequent successful send). Driven by the
   *  invitation + reminder send paths in lib/actions/invitations.ts and
   *  /api/cron/send-reminders. */
  lastSendFailedAt: string | null;
  /** D66 — Vault-encrypted plaintext 6-digit access code. Pass a fresh
   *  ciphertext on resend (mint a new code alongside the new token), or
   *  null on revoke to clear (terminal kill, mirrors the
   *  tokenPlaintextEncrypted nulling at revoke). Never logged. */
  accessCodeEncrypted: string | null;
  /** D66 — ISO timestamp (when /enter first fresh-claimed) or null to
   *  reset. Cleared on resend's `fresh` branch (the new code is unused);
   *  preserved as-is on resend's `resume` branch (the previous /enter
   *  fresh-claim, if any, stays attributable). */
  accessCodeUsedAt: string | null;
}>;

/** Update an invitation. Owner only (enforced by RLS). */
export async function updateInvitation(
  supabase: SupabaseClient<Database>,
  id: string,
  input: UpdateInvitationInput
): Promise<Invitation> {
  const update: DbUpdate = {};
  if (input.tokenHash !== undefined) update.token_hash = input.tokenHash;
  if (input.tokenPlaintextEncrypted !== undefined)
    update.token_plaintext_encrypted = input.tokenPlaintextEncrypted;
  if (input.status !== undefined) update.status = input.status;
  if (input.expiresAt !== undefined) update.expires_at = input.expiresAt;
  if (input.maxUses !== undefined) update.max_uses = input.maxUses;
  if (input.sentAt !== undefined) update.sent_at = input.sentAt;
  if (input.openedAt !== undefined) update.opened_at = input.openedAt;
  if (input.startedAt !== undefined) update.started_at = input.startedAt;
  if (input.submittedAt !== undefined)
    update.submitted_at = input.submittedAt;
  if (input.useCount !== undefined) update.use_count = input.useCount;
  if (input.lastSendFailedAt !== undefined)
    update.last_send_failed_at = input.lastSendFailedAt;
  if (input.accessCodeEncrypted !== undefined)
    update.access_code_encrypted = input.accessCodeEncrypted; // D66
  if (input.accessCodeUsedAt !== undefined)
    update.access_code_used_at = input.accessCodeUsedAt; // D66

  const { data, error } = await supabase
    .from("invitations")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToInvitation(data);
}
