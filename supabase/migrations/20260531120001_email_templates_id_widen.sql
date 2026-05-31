-- 20260531120001_email_templates_id_widen.sql
--
-- D22 Stage 2 — widens the email_templates.id CHECK enum to include
-- 'admin-invite' and 'submission', the two additional templates the
-- editor now manages.
--
-- Paired with:
--   lib/email/templates/types.ts      (TemplateId union + TEMPLATE_SPECS)
--   lib/email/templates/defaults.ts   (byte-extracted defaults for both)
--   lib/email/admin-invite.ts         (rewritten as a thin wrapper)
--   lib/email/submission.ts           (rewritten as a thin wrapper)
--   app/admin/(protected)/settings/email-templates/page.tsx (extends TEMPLATES)
--
-- WHY a drop+re-add rather than ALTER ... ADD: PostgreSQL has no
-- syntax to extend a column-level CHECK constraint in place. The
-- drop+re-add runs in a single transaction, so no intermediate
-- "constraint absent" window is observable to concurrent writes.
--
-- The constraint name 'email_templates_id_check' is the PG-generated
-- auto-name for an inline column CHECK (table_column_check). IF EXISTS
-- guards the rare case a prior environment renamed it manually.
--
-- The four pre-existing aspirational ids (reminder1, reminderFinal,
-- thankYou, v2Migration) STAY in the allow-list. No app code writes
-- them today; removing them would be a behavioral change unrelated
-- to Stage 2 and a forward-compat regression. Carrying them costs
-- nothing.
--
-- The existing 'invitation' row survives unchanged — its id is still
-- in the new allow-list. No data migration.
--
-- TX-SAFE + IDEMPOTENT. Safe to re-apply, safe to land in a partial
-- `supabase db push`.
--
-- DEPLOY ORDER (matters): this migration MUST COMMIT before the code
-- that upserts 'admin-invite' or 'submission' rows deploys. Same
-- lead-the-code rule as 20260527130001_invitation_status_revoked.
-- Natural order:
--   1. Saeed runs `supabase db push` → this migration commits.
--   2. Saeed runs `supabase gen types typescript` against prod →
--      regenerated lib/supabase/database.types.ts (column CHECK lives
--      outside the TS types so the file probably doesn't change at
--      all; running anyway for hygiene).
--   3. Vercel deploys the code (which now references the two new ids).

BEGIN;

ALTER TABLE email_templates
  DROP CONSTRAINT IF EXISTS email_templates_id_check;

ALTER TABLE email_templates
  ADD CONSTRAINT email_templates_id_check
  CHECK (id IN ('invitation', 'reminder1', 'reminderFinal',
                'thankYou', 'v2Migration',
                'admin-invite', 'submission'));

COMMIT;
