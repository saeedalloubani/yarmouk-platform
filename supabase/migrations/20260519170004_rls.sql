-- 20260519170004_rls.sql
-- Row-level security on every table.
--
-- Postgres roles in Supabase:
--   anon          — public, unauthenticated. No direct grants here.
--                   Public flow uses service_role + validate_invitation_token().
--   authenticated — any signed-in user. Our `admins` table further gates
--                   by current_admin_role() returning 'owner' | 'readonly' | NULL.
--   service_role  — bypasses RLS entirely. Used for migrations, seeds,
--                   /api/public/* handlers, cron jobs.
--
-- Read-only access to PII tables (invitations, recordings) is granted in
-- 20260519170005 alongside the redacted views — keeping the view + its read policy
-- together makes the redaction story easier to audit.

-- ============================================================================
-- Enable RLS on every table
-- ============================================================================

ALTER TABLE admins                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE researcher_notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups                   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Owner-only tables
-- ============================================================================
-- admins, settings, audit_log (SELECT), backups, consent_records.

CREATE POLICY admins_owner_all ON admins
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY settings_owner_all ON settings
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

-- audit_log: Owner can SELECT. INSERTs come from the application via
-- service_role (which bypasses RLS) — no INSERT policy for authenticated.
CREATE POLICY audit_log_owner_select ON audit_log
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'owner');

CREATE POLICY backups_owner_all ON backups
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY consent_records_owner_all ON consent_records
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

-- Read-only SELECT policy for consent_records lives in 20260519170005 next to
-- consent_records_redacted, matching the convention: policies live
-- with the view they enable.

-- ============================================================================
-- PII tables — Owner-only at the base. Read-only gets the redacted view
-- ============================================================================
-- The matching read-only SELECT policies live in 20260519170005 next to the views.

CREATE POLICY invitations_owner_all ON invitations
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY recordings_owner_all ON recordings
  FOR ALL TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

-- ============================================================================
-- Shared admin tables (both roles SELECT, Owner mutates)
-- ============================================================================

-- questionnaire_versions
CREATE POLICY qv_admins_select ON questionnaire_versions
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY qv_owner_insert ON questionnaire_versions
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY qv_owner_update ON questionnaire_versions
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY qv_owner_delete ON questionnaire_versions
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- questions
CREATE POLICY q_admins_select ON questions
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY q_owner_insert ON questions
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY q_owner_update ON questions
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY q_owner_delete ON questions
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- responses
CREATE POLICY r_admins_select ON responses
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY r_owner_insert ON responses
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY r_owner_update ON responses
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY r_owner_delete ON responses
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- answers
CREATE POLICY a_admins_select ON answers
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY a_owner_insert ON answers
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY a_owner_update ON answers
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY a_owner_delete ON answers
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- tags
CREATE POLICY t_admins_select ON tags
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY t_owner_insert ON tags
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY t_owner_update ON tags
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY t_owner_delete ON tags
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- response_tags
CREATE POLICY rt_admins_select ON response_tags
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY rt_owner_insert ON response_tags
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY rt_owner_delete ON response_tags
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- researcher_notes
CREATE POLICY rn_admins_select ON researcher_notes
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY rn_owner_insert ON researcher_notes
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY rn_owner_update ON researcher_notes
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY rn_owner_delete ON researcher_notes
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- email_templates
CREATE POLICY et_admins_select ON email_templates
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY et_owner_insert ON email_templates
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY et_owner_update ON email_templates
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY et_owner_delete ON email_templates
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');

-- ============================================================================
-- Per-admin tables (each admin sees only their own row)
-- ============================================================================

CREATE POLICY n_self_select ON notifications
  FOR SELECT TO authenticated
  USING (recipient_admin_id = current_admin_id());

CREATE POLICY n_self_update ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_admin_id = current_admin_id())
  WITH CHECK (recipient_admin_id = current_admin_id());

-- INSERT to notifications comes from the notifications service via
-- service_role. DELETE is not exposed (retention rules).

CREATE POLICY np_self_select ON notification_preferences
  FOR SELECT TO authenticated
  USING (admin_id = current_admin_id());

CREATE POLICY np_self_insert ON notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (admin_id = current_admin_id());

CREATE POLICY np_self_update ON notification_preferences
  FOR UPDATE TO authenticated
  USING (admin_id = current_admin_id())
  WITH CHECK (admin_id = current_admin_id());
