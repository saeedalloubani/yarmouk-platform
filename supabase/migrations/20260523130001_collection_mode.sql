-- 20260523130001_collection_mode.sql
--
-- collection_mode marker on invitations (Session 6 — recordings / interview).
--
-- Distinguishes a SELF-COMPLETED response (the respondent opens the link and
-- fills the questionnaire themselves) from an INTERVIEW (the researcher
-- conducts the session offline, then fills the response via the same link on
-- the participant's behalf — see TASK_STATE). This is ORTHOGONAL to
-- audio_consent: an interview may or may not be recorded, and audio consent is
-- a separate consent_records flag. Default 'self_completed' so every existing /
-- un-marked invitation reads correctly. The response inherits the mode through
-- its invitation FK — there is deliberately NO column on responses; the mode is
-- joined through invitations.

CREATE TYPE collection_mode AS ENUM ('self_completed', 'interview');

ALTER TABLE invitations
  ADD COLUMN collection_mode collection_mode NOT NULL DEFAULT 'self_completed';
