-- 20260527120001_email_templates_sections.sql
--
-- D22 — restructure email_templates from "body as one TEXT blob" to
-- "sections as JSONB" so an editor UI can edit named, validated sections
-- (intro / cta / personal / expiry / contact) independently rather than
-- one opaque body string.
--
-- The table was created in 20260519170002 with body_en + body_ar TEXT
-- columns and has NEVER had a row inserted (no seed, no INSERT in any
-- application code path before this migration). So the column swap is
-- LOSSLESS — there is no data to migrate.
--
-- Two more changes for forward-compatibility with future EN-only templates
-- (admin-invite, submission notification, etc.) that haven't been wired
-- into the editor yet but will be in Stage 2:
--   1. subject_ar NOT NULL  →  NULL allowed. A future EN-only template can
--      omit it. The 'invitation' template (Stage 1, bilingual) still
--      requires both in the application-layer validation.
--   2. sections_ar JSONB    →  NULL allowed (same reason).
--
-- RLS (et_admins_select / et_owner_insert / et_owner_update / et_owner_delete)
-- from 20260519170004 carries over unchanged — the column shape changed,
-- the access policies didn't.
--
-- The 'id' CHECK enum (id IN ('invitation', 'reminder1', 'reminderFinal',
-- 'thankYou', 'v2Migration')) is also unchanged. Stage 1 wires 'invitation'
-- only; the four other ids remain aspirational placeholders.

BEGIN;

ALTER TABLE email_templates DROP COLUMN body_en;
ALTER TABLE email_templates DROP COLUMN body_ar;

ALTER TABLE email_templates ALTER COLUMN subject_ar DROP NOT NULL;

ALTER TABLE email_templates ADD COLUMN sections_en JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE email_templates ADD COLUMN sections_ar JSONB;

COMMENT ON COLUMN email_templates.sections_en IS
  'Named body sections per locale. For the invitation template: { intro, cta, personal, expiry, contact }. Validated at the application layer against a per-template allowlist of placeholders ({name}, {expiry_date}, {ref_code}). The magic-link URL is NEVER a placeholder — it is the system-owned href of a button the renderer always emits.';

COMMENT ON COLUMN email_templates.sections_ar IS
  'Same shape as sections_en, for the Arabic locale. Nullable to allow future EN-only templates; per-template validation enforces presence for bilingual templates (e.g. invitation).';

COMMIT;
