-- 20260602130000_invitations_redacted_collection_mode.sql
--
-- D69 ITEM 2 — surface `collection_mode` in `invitations_redacted` (Task #55
-- closure). Originally deferred from D58 → audited at D64 → D67 → D68; readonly
-- supervisors gain visibility into how each invitation is being collected
-- (self_completed vs interview), an operational classification (NOT PII).
--
-- Forward-only: collection_mode is NOT NULL DEFAULT 'self_completed' on the
-- base, so every existing row is already populated; no backfill needed.
--
-- Latent bug closed: lib/repos/invitations.ts already read `r.collection_mode`
-- via the `row as DbRow` NOT-NULL-recovery cast (watch-out #5). For readonly
-- callers this read was hitting a view row without the column projected →
-- runtime undefined masquerading as InvitationCollectionMode. The mapper line
-- stays unchanged; the view projection makes the read honest.
--
-- Pattern: DROP+CREATE matching D66 migration 12001's redacted-view recreate.
-- security_invoker = true preserved. REVOKE+GRANT restated. New column placed
-- after `nationality` to group "who they are + how we're collecting from
-- them"; ordering is cosmetic (view columns are addressed by name).

BEGIN;

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
    collection_mode,
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
