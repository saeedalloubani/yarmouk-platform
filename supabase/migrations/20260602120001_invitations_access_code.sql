-- 20260602120001_invitations_access_code.sql
--
-- D66 — Participant invitation URL prefetch defense (6-digit access code
-- fallback). Mirrors the participant-facing equivalent of D65's admin OTP
-- code: every invitation gains a 6-digit access code shipped as TEXT in
-- the email body alongside the URL. If Microsoft 365 Defender / Outlook
-- prefetches the URL (consuming the single-use token before the recipient
-- can click — same vector that broke admin login pre-D65), the recipient
-- types the code at /enter as a rescue path.
--
-- COLUMNS:
--
--   access_code_encrypted  TEXT NULL  — Vault-encrypted plaintext 6-digit
--     code. Same security model as recipient_email_encrypted +
--     token_plaintext_encrypted (D64 STEP 6.5):
--       - Vault key (pii_key) accessed ONLY by SECURITY DEFINER functions
--         encrypt_pii / decrypt_pii.
--       - Plaintext NEVER appears in cleartext storage, logs, audit
--         metadata, or response bodies.
--       - Reminders decrypt + embed in email body scoped to a single
--         cron-loop iteration; falls out of scope at function return.
--     NULLABLE because pre-D66 invitations don't have it. Forward-only:
--     pre-D66 rows keep NULL and the new RPC's candidate filter
--     (`access_code_encrypted IS NOT NULL`) silently excludes them. Sura
--     uses manual resend (which mints + populates) to recover those.
--
--   access_code_used_at    TIMESTAMPTZ NULL  — Stamped to NOW() by
--     validate_invitation_code on ANY successful validation (fresh claim
--     OR resumption — strict single-use). Mirrors reminder1_sent_at's
--     treatment as a non-secret operational timestamp:
--       - IN the invitations_redacted view (read-only admins can see
--         "code was used at X" for forensic + audit purposes).
--       - Once NOT NULL, the candidate filter in validate_invitation_code
--         excludes the row (no second use possible).
--     NULL = code is live and usable (or never minted, if
--     access_code_encrypted is also NULL).
--
-- WHY NO access_code_hash COLUMN — design decision recorded in
-- DECISIONS.md D66:
--   The brief's 2-column scope (access_code_encrypted +
--   access_code_used_at) matches a brute-decrypt-scan lookup pattern in
--   the new RPC: O(N) decrypt-and-compare over candidate rows
--   (access_code_encrypted IS NOT NULL, access_code_used_at IS NULL,
--   expires_at > NOW()). At pilot scale (≤30 active invitations)
--   sub-millisecond. A SHA-256 hash column would enable O(1) lookup but
--   would be rainbow-table-trivial (6 digits = 1M codes — precomputable
--   in seconds) and would require careful exclusion from views. Brute-
--   decrypt is the simpler, more conservative path at pilot scale.
--   Revisit if active invitation count crosses ~200.
--
-- WHY NO access_code_hash means BRUTE-FORCE RESISTANCE is layered:
--   1. /enter Server Action does best-effort rate limiting (per-IP, in-
--      memory; won't survive Vercel cold starts but adds friction).
--   2. Every failed /enter attempt writes an audit row (severity=warn,
--      metadata={ reason: 'invalid_or_expired' }, no IP-derived recipient
--      guess). Sura sees brute-force patterns in audit log even if rate
--      limit doesn't catch everything.
--   3. Single-use semantic — first successful validation burns the code.
--      An attacker who lands a valid code by brute force burns it; the
--      legitimate recipient then can't use /enter and must contact Sura,
--      who sees the brute-force pattern in audit.
--   4. URL secret (token_plaintext) remains the strong primary defense.
--      Brute force on /enter doesn't help an attacker if they don't also
--      have the URL.
--
-- VIEW RECREATE — invitations_redacted grows from 21 → 22 columns by
-- appending access_code_used_at at the end. access_code_encrypted is NOT
-- in the view (same rationale as token_plaintext_encrypted +
-- token_hash — secrets at rest don't go through the readonly admin
-- surface).
--
-- NOT TOUCHED here:
--   - collection_mode (Task #55, latent bug — to be addressed in D67 or
--     later; out of scope for D66 to keep blast radius tight).
--   - validate_invitation_token RPC (D66 brief constraint: untouched,
--     additive new RPC only — validate_invitation_code).
--   - /r/[token] route (D66 brief constraint: untouched).
--
-- IDEMPOTENT — IF NOT EXISTS on ALTER TABLE + IF EXISTS on DROP VIEW.
-- Safe to re-apply, safe to land in a partial supabase db push.
--
-- The view recreate runs in the SAME transaction as the column adds so
-- external readers never observe a half-applied state (column added but
-- view still on old shape, or view dropped mid-request). Same atomic-swap
-- pattern as D64 STEP 1.
--
-- DEPLOY ORDER (matters): this migration MUST COMMIT before the code
-- that writes / references these columns deploys. Lead-the-code rule.
-- Natural order:
--   1. Saeed runs `supabase db push` → this migration commits.
--   2. Saeed runs `supabase gen types typescript` against prod → the
--      regenerated lib/supabase/database.types.ts picks up the 2 new
--      nullable columns on invitations + the new column on
--      invitations_redacted.
--   3. Saeed applies the next migration (validate_invitation_code RPC,
--      separate file 20260602120002) and re-runs gen-types.
--   4. Vercel deploys the code (which now references the new columns +
--      the new RPC).

BEGIN;

-- ---------- 1. New invitations columns ----------

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS access_code_encrypted TEXT NULL,
  ADD COLUMN IF NOT EXISTS access_code_used_at   TIMESTAMPTZ NULL;

COMMENT ON COLUMN invitations.access_code_encrypted IS
  'Vault-encrypted plaintext 6-digit access code (encrypted via '
  'encrypt_pii). The participant rescue path for /enter — typed when the '
  'invitation URL has been prefetched/consumed by an email scanner. '
  'NULL for pre-D66 invitations (the cron / RPC skip those). Written at '
  'create-time and rotation-time. Decrypted by validate_invitation_code '
  '(in the RPC, scoped to a single transaction) and by the reminder cron '
  '(service-role, scoped to a single iteration). Never decrypted in any '
  'other context.';

COMMENT ON COLUMN invitations.access_code_used_at IS
  'Set by validate_invitation_code to NOW() on ANY successful validation '
  '(fresh claim or resumption). Strict single-use: once stamped, the RPC '
  'candidate filter excludes this row and the code can never be redeemed '
  'again. NULL = code is live and usable (or never minted, if '
  'access_code_encrypted is also NULL).';

-- ---------- 2. Redacted view recreate ----------
-- Drop + recreate is the only way to extend a view's column list in PG.
-- Inside the same transaction so concurrent readers never see a half-
-- applied state. The 1 new column (access_code_used_at — non-secret
-- operational timestamp) appends at the end, preserving the original 21
-- column positions. access_code_encrypted is NOT in the view (secret at
-- rest, same treatment as token_hash + token_plaintext_encrypted).

DROP VIEW IF EXISTS invitations_redacted;

CREATE VIEW invitations_redacted
  WITH (security_invoker = true)
AS
  SELECT
    id,
    ref_code,
    NULL::TEXT AS recipient_name_encrypted,
    NULL::TEXT AS recipient_email_encrypted,
    category,
    nationality,
    preferred_language,
    questionnaire_version_id,
    status,
    expires_at,
    use_count,
    max_uses,
    sent_at,
    opened_at,
    started_at,
    submitted_at,
    created_at,
    created_by,
    reminder1_sent_at,
    reminder_final_sent_at,
    last_send_failed_at,
    access_code_used_at
  FROM invitations;

REVOKE ALL ON invitations_redacted FROM PUBLIC;
GRANT SELECT ON invitations_redacted TO authenticated;

COMMIT;
