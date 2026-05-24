-- 20260524140002_pilot_variant_split_rows.sql
--
-- Companion to 20260524140001. Replaces the obsolete combined pilot variant
-- with 3 per-category DRAFT pilot versions (content seeded later, PIECE 2;
-- activated after Sura proofs each rendered variant).
--
-- SAFE: the combined variant (pilot_researchers_donors_ngos) has 0 questions
-- and 0 invitations (proven before apply), so the row DELETE cascades nothing
-- (questions.version_id and invitations.questionnaire_version_id both reference
-- it zero times). The enum VALUE 'pilot_researchers_donors_ngos' is NOT dropped
-- — Postgres can't remove enum values without recreating the type; it simply
-- lingers as an unused tombstone, never referenced again.
--
-- ⚠️ Apply ONLY AFTER 20260524140001 has been pushed in a SEPARATE transaction,
-- so the new enum values are committed and usable in the INSERT below.

DELETE FROM questionnaire_versions
 WHERE variant = 'pilot_researchers_donors_ngos';

INSERT INTO questionnaire_versions
  (type, variant, version_number, status, includes_feedback_block)
VALUES
  ('pilot', 'pilot_researchers', 1, 'draft', true),
  ('pilot', 'pilot_donors',      1, 'draft', true),
  ('pilot', 'pilot_ngos',        1, 'draft', true);
