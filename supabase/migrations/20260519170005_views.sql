-- 20260519170005_views.sql
-- Redacted views for the three PII tables, plus the read-only SELECT
-- policies on `invitations` and `recordings` (the consent_records
-- read-only policy lives in 20260519170004 alongside its Owner-only policy).
--
-- Views use `security_invoker = true` (Postgres 15+): the view runs with
-- the calling user's privileges, so the base table's RLS still applies.
-- An authenticated non-admin (role = NULL) gets zero rows. A read-only
-- admin gets rows with PII columns masked to NULL. An owner could query
-- the view too, but should query the base table directly (the repo layer
-- in lib/repos/* enforces this).
--
-- Defence in depth, three layers:
--   1. RLS — readonly_select policies admit the row on the base.
--   2. View — masks PII columns to NULL via static NULL::TYPE columns.
--   3. Encryption — PII columns are pgcrypto-encrypted at rest.
--      Decryption key lives in Supabase Vault, accessed only inside
--      SECURITY DEFINER functions (D36). A Read-only admin who somehow
--      reached the base table would see ciphertext, not plaintext.
--
-- Trade-off note vs. SCHEMA.md's "column-level SELECT only to Owner":
-- Supabase puts all admins in the same `authenticated` Postgres role, so
-- column GRANTs can't differ between them. The three-layer model above
-- is the practical equivalent.

-- ---------- invitations_redacted ----------
-- token_hash is NOT in this view. Even hashed, the token is a secret —
-- read-only admins identify invitations by ref_code, not by token.

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
    created_by
  FROM invitations;

REVOKE ALL ON invitations_redacted FROM PUBLIC;
GRANT SELECT ON invitations_redacted TO authenticated;

-- Read-only admins need SELECT on the base for the view to return rows
-- (security_invoker = true). The view masks PII; this policy is the row
-- gate. Owner's policy is in 20260519170004.
CREATE POLICY invitations_readonly_select ON invitations
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'readonly');

-- ---------- recordings_redacted ----------
-- audio_filename is masked too: filenames can carry respondent PII
-- (e.g., "interview-john-smith-2026-04-12.mp3"). Read-only admins
-- identify recordings by response_id + uploaded_at + duration + status.
-- Session 6 (upload implementation) may switch to filename-on-upload
-- renaming for opaqueness; until then this view is the redaction line.

CREATE VIEW recordings_redacted
  WITH (security_invoker = true)
AS
  SELECT
    id,
    response_id,
    NULL::TEXT AS audio_storage_path,
    NULL::TEXT AS audio_filename,
    audio_duration_seconds,
    audio_size_bytes,
    NULL::TEXT AS transcript_original,
    CASE WHEN status = 'published'
         THEN transcript_anonymized
         ELSE NULL
         END AS transcript_anonymized,
    NULL::JSONB AS substitution_key,
    language,
    status,
    uploaded_by,
    uploaded_at,
    published_at
  FROM recordings;

REVOKE ALL ON recordings_redacted FROM PUBLIC;
GRANT SELECT ON recordings_redacted TO authenticated;

CREATE POLICY recordings_readonly_select ON recordings
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'readonly');

-- ---------- consent_records_redacted ----------
-- Read-only supervisors need to verify "consent was given for this
-- response" without seeing the signed name. View masks signed_name_encrypted;
-- everything else (the consent booleans, timestamp, language, version) is
-- exposed because it's non-identifying.

CREATE VIEW consent_records_redacted
  WITH (security_invoker = true)
AS
  SELECT
    id,
    response_id,
    NULL::TEXT AS signed_name_encrypted,
    signed_at,
    audio_consent,
    agreed_to_read,
    agreed_to_participate,
    consent_text_version,
    language
  FROM consent_records;

REVOKE ALL ON consent_records_redacted FROM PUBLIC;
GRANT SELECT ON consent_records_redacted TO authenticated;

CREATE POLICY consent_records_readonly_select ON consent_records
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'readonly');
