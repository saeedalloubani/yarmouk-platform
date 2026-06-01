-- 20260601130001_invitations_reminders_and_send_failure.sql
--
-- D64 — Cluster A items #1 + #2 (reminder emails + send-failure surface):
--
--   - reminder1_sent_at         TIMESTAMPTZ NULL  — cron stamp after reminder1 sends ok
--   - reminder_final_sent_at    TIMESTAMPTZ NULL  — cron stamp after reminderFinal sends ok
--   - last_send_failed_at       TIMESTAMPTZ NULL  — most recent Resend failure across the
--                                                   invitation-row-bound send paths
--                                                   (createInvitation, resendInvitation,
--                                                   reminder1, reminderFinal). Cleared
--                                                   (set NULL) on the next ok send from
--                                                   the same row.
--
-- NAMING — snake_case across the board. The template id `reminderFinal`
-- in the email_templates.id CHECK enum stays mixed-case for historical
-- reasons (declared in the initial schema 20260519170002_tables.sql;
-- changing it would be a destructive rename for no functional gain).
-- The cron route owns a 3-line { kind → column } map that translates
-- 'reminderFinal' ↔ 'reminder_final_sent_at'. Codebase snake_case
-- convention wins over one-join-site convenience.
--
-- SCOPE — last_send_failed_at is written ONLY by the two
-- invitation-row-bound wrappers (lib/email/invitation.ts and the new
-- lib/email/reminder.ts). The admin-invite + submission wrappers will
-- still write an audit row on failure (cheap forensic surface) but do
-- NOT touch invitations columns — submission has no invitation_id at
-- all, and admin-invite is admins-row-bound (no surface on /admin/
-- settings/team this pass).
--
-- IDEMPOTENT via IF NOT EXISTS on ALTER TABLE columns + IF EXISTS on
-- DROP VIEW. Safe to re-apply, safe to land in a partial supabase db
-- push.
--
-- The redacted-view recreate is in the SAME transaction as the column
-- adds so external readers never observe a half-applied state (columns
-- added but view still listing the old shape, or view dropped mid-
-- request). PG has no in-place "ALTER VIEW … ADD COLUMN" — DROP VIEW
-- + CREATE VIEW is the only path; running inside BEGIN/COMMIT makes
-- the swap atomic from any concurrent reader's perspective.
--
-- COLUMN POSITIONS in the recreated view are preserved: the original
-- 18 columns appear in their original positions; the 3 new columns
-- append AT THE END. Position-based readers (none in this codebase —
-- repos select by name — but defensive against any external/manual
-- consumer) remain stable.
--
-- NOT ADDED HERE — `collection_mode` is on the base table since
-- 20260523130001 but was never added to invitations_redacted. Adding
-- it would be a drive-by fix for a latent readonly-admin bug
-- (rowToInvitation returns collectionMode=undefined for readonly via
-- the view today). Out of scope for D64; tracked in TASK_STATE.md as
-- a separate audit so it gets its own decision + smoke proof.
--
-- DEPLOY ORDER (matters): this migration MUST COMMIT before the code
-- that writes any of these columns deploys. Lead-the-code rule, same
-- as D63's responses_status_withdraw migration. Natural order:
--   1. Saeed runs `supabase db push` → this migration commits.
--   2. Saeed runs `supabase gen types typescript` against prod →
--      regenerated lib/supabase/database.types.ts picks up the 3 new
--      nullable columns on invitations + invitations_redacted.
--   3. Vercel deploys the code (which now references the new columns).

BEGIN;

-- ---------- 1. New invitations columns ----------

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS reminder1_sent_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_final_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_send_failed_at    TIMESTAMPTZ NULL;

COMMENT ON COLUMN invitations.reminder1_sent_at IS
  'Set by /api/cron/send-reminders after a successful reminder1 Resend send. '
  'NULL = not yet sent OR the last attempt failed (cron retries next run). '
  'Stamped POST-OK so a duplicate cron fire never double-sends (D64 '
  'idempotency-by-design).';

COMMENT ON COLUMN invitations.reminder_final_sent_at IS
  'Set by /api/cron/send-reminders after a successful reminderFinal Resend send. '
  'NULL = not yet sent OR the last attempt failed (cron retries next run). '
  'Stamped POST-OK so a duplicate cron fire never double-sends (D64 '
  'idempotency-by-design).';

COMMENT ON COLUMN invitations.last_send_failed_at IS
  'Most recent Resend failure across the invitation-row-bound send paths '
  '(createInvitation, resendInvitation, reminder1, reminderFinal). Cleared '
  '(set NULL) on the next successful send from the same row. Drives the '
  '"send failed" chip on /admin/invitations (D64). NOT written by the '
  'admin-invite or submission paths (those are not invitation-row-bound).';

-- ---------- 2. Redacted view recreate ----------
-- Drop + recreate is the only way to extend a view's column list in PG.
-- Inside the same transaction so RLS-gated readers never observe the
-- swap mid-flight. The 3 new columns are appended AT THE END to preserve
-- the original 18-column positions.

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
    last_send_failed_at
  FROM invitations;

REVOKE ALL ON invitations_redacted FROM PUBLIC;
GRANT SELECT ON invitations_redacted TO authenticated;

COMMIT;
