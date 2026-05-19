-- 20260519170007_settings_seed.sql
-- Pre-populate the settings key-value table with defaults from SCHEMA.md.
-- Idempotent: re-running is a no-op (ON CONFLICT DO NOTHING).
--
-- This file intentionally seeds ONLY the settings table. Questionnaire
-- seed data (Pilot V1 · Officials questions + the 6 Draft entries for
-- the other variants) is out of scope for Session 2a — that lands in a
-- later migration once we've validated the schema.

INSERT INTO settings (key, value) VALUES
  ('retention_period_months',  '24'::jsonb),
  ('ethics_approval_ref',      '""'::jsonb),
  ('ethics_committee',         '""'::jsonb),
  ('ethics_approval_date',     'null'::jsonb),
  ('ethics_approval_expiry',   'null'::jsonb),
  ('public_domain',            '"karasneh-research.org"'::jsonb),
  ('sender_email',             '"invitations@karasneh-research.org"'::jsonb),
  ('sender_name',              '"Sura Karasneh — Yarmouk Study"'::jsonb),
  ('reply_to',                 '"sjkarasneh24@eng.just.edu.jo"'::jsonb)
ON CONFLICT (key) DO NOTHING;
