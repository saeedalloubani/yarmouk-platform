-- 20260519170006_indexes.sql
-- Indexes: the partial unique on questionnaire_versions (the load-bearing
-- methodological invariant from D10/D11), plus secondary indexes sized
-- for the queries each table will actually serve.

-- D10/D11: exactly one ACTIVE version per variant at any time.
-- Drafts and closed versions are unconstrained.
--
-- Assumes no pre-existing duplicate active versions in the data.
-- If migrating from messy data later (e.g., an import that didn't
-- enforce this invariant), deduplicate first or this index creation
-- will fail with a unique-violation error and abort the migration.
CREATE UNIQUE INDEX one_active_version_per_variant
  ON questionnaire_versions (variant)
  WHERE status = 'active';

-- ---------- invitations ----------
CREATE INDEX idx_invitations_status                ON invitations (status);
CREATE INDEX idx_invitations_questionnaire_version ON invitations (questionnaire_version_id);
CREATE INDEX idx_invitations_category_nationality  ON invitations (category, nationality);
CREATE INDEX idx_invitations_created_at_desc       ON invitations (created_at DESC);
CREATE INDEX idx_invitations_expires_at            ON invitations (expires_at);

-- ---------- responses ----------
CREATE INDEX idx_responses_invitation_id ON responses (invitation_id);
CREATE INDEX idx_responses_submitted_at
  ON responses (submitted_at DESC)
  WHERE submitted_at IS NOT NULL;

-- ---------- answers ----------
CREATE INDEX idx_answers_response_id ON answers (response_id);
CREATE INDEX idx_answers_question_id ON answers (question_id);

-- ---------- questions ----------
CREATE INDEX idx_questions_version_order ON questions (version_id, order_index);

-- ---------- audit_log ----------
CREATE INDEX idx_audit_log_ts_desc        ON audit_log (ts DESC);
CREATE INDEX idx_audit_log_actor_admin_id ON audit_log (actor_admin_id);
CREATE INDEX idx_audit_log_action         ON audit_log (action);
CREATE INDEX idx_audit_log_severity_warn
  ON audit_log (severity)
  WHERE severity IN ('warn', 'alert');

-- ---------- notifications ----------
CREATE INDEX idx_notifications_unread
  ON notifications (recipient_admin_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX idx_notifications_recipient_recent
  ON notifications (recipient_admin_id, created_at DESC);

-- ---------- recordings ----------
CREATE INDEX idx_recordings_response_id ON recordings (response_id);
CREATE INDEX idx_recordings_status      ON recordings (status);

-- ---------- response_tags ----------
-- The PK already covers (response_id, tag_id). Index the other direction.
CREATE INDEX idx_response_tags_tag_id ON response_tags (tag_id);

-- ---------- tags ----------
CREATE INDEX idx_tags_category ON tags (category);

-- ---------- consent_records ----------
-- response_id is already UNIQUE on the column, which gives us an index.
-- No additional index needed.

-- ---------- backups ----------
CREATE INDEX idx_backups_created_at_desc ON backups (created_at DESC);
CREATE INDEX idx_backups_pinned
  ON backups (pinned)
  WHERE pinned = TRUE;
