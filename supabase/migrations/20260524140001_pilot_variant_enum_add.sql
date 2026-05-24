-- 20260524140001_pilot_variant_enum_add.sql
--
-- D8 REVISED: the pilot is now 4 per-category variants (officials, researchers,
-- donors, ngos), NOT 2 (officials + a combined researchers_donors_ngos). The 4
-- pilot category questionnaires are genuinely different — they share a Q1-Q4 +
-- catch-all + F1-F4 core but have distinct category-specific middle blocks, so
-- one combined variant cannot serve all three. This adds the 3 new per-category
-- pilot enum values to questionnaire_variant.
--
-- ⚠️ TWO-STEP / TWO-PUSH — DO NOT SQUASH. Postgres forbids USING a newly-added
-- enum value in the SAME transaction that adds it. This migration ONLY adds the
-- values. The companion 20260524140002 (split rows) USES them and MUST be
-- applied in a SEPARATE `supabase db push` so this one has committed first.
-- IF YES (IDEMPOTENT): ADD VALUE IF NOT EXISTS is safe to re-run.

ALTER TYPE questionnaire_variant ADD VALUE IF NOT EXISTS 'pilot_researchers';
ALTER TYPE questionnaire_variant ADD VALUE IF NOT EXISTS 'pilot_donors';
ALTER TYPE questionnaire_variant ADD VALUE IF NOT EXISTS 'pilot_ngos';
