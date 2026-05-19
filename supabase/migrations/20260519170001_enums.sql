-- 20260519170001_enums.sql
-- Extensions and Postgres enums for all closed-set columns.
-- This is the first migration; nothing depends on its idempotency, but we
-- use IF NOT EXISTS on the extension to make local re-runs friendlier.

-- pgcrypto: gen_random_uuid() and PGP encrypt/decrypt helpers for PII
-- columns. Supabase enables pgcrypto by default in new projects; included
-- explicitly so a fresh local DB also has it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enums ----------

CREATE TYPE admin_role AS ENUM ('owner', 'readonly');

CREATE TYPE questionnaire_type AS ENUM ('pilot', 'main');

CREATE TYPE questionnaire_variant AS ENUM (
  'pilot_officials',
  'pilot_researchers_donors_ngos',
  'main_researchers',
  'main_donors',
  'main_ngos',
  'main_officials_jordanian',
  'main_officials_syrian'
);

CREATE TYPE version_status AS ENUM ('draft', 'active', 'closed');

CREATE TYPE invitation_status AS ENUM (
  'sent', 'opened', 'started', 'submitted', 'expired'
);

CREATE TYPE category_type AS ENUM (
  'officials', 'researchers', 'donors', 'ngos'
);

CREATE TYPE nationality_type AS ENUM (
  'jordanian', 'syrian', 'not_applicable'
);

CREATE TYPE transcript_status AS ENUM (
  'audio_only', 'transcribing', 'transcribed', 'anonymizing', 'published'
);

CREATE TYPE notification_type AS ENUM ('submission', 'invitation', 'system');

CREATE TYPE event_severity AS ENUM ('info', 'warn', 'alert');
