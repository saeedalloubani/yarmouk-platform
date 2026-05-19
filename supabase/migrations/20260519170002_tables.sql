-- 20260519170002_tables.sql
-- All application tables. RLS is enabled in 20260519170004; indexes in 20260519170006;
-- redacted views in 20260519170005.
--
-- Conventions:
-- - UUID PKs via gen_random_uuid() (from pgcrypto enabled in 20260519170001).
-- - TIMESTAMPTZ for time columns, default NOW() where it makes sense.
-- - PII fields use *_encrypted TEXT (pgcrypto + Vault key, set at the
--   application layer via lib/encryption.ts).
-- - Soft delete only on admins (removed_at + status check).

-- ---------- admins ----------

CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          admin_role NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'removed')),
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at  TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ
);

-- ---------- questionnaire_versions ----------

CREATE TABLE questionnaire_versions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                     questionnaire_type NOT NULL,
  variant                  questionnaire_variant NOT NULL,
  version_number           INT NOT NULL CHECK (version_number >= 1),
  status                   version_status NOT NULL DEFAULT 'draft',
  includes_feedback_block  BOOLEAN NOT NULL DEFAULT FALSE,
  published_at             TIMESTAMPTZ,
  closed_at                TIMESTAMPTZ,
  UNIQUE (variant, version_number),
  -- D9: feedback block only on pilots
  CHECK (NOT (type = 'main' AND includes_feedback_block))
);

-- ---------- questions ----------

CREATE TABLE questions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id             UUID NOT NULL
                         REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  question_code          TEXT NOT NULL,
  order_index            INT NOT NULL,
  text_en                TEXT NOT NULL,
  text_ar                TEXT NOT NULL,
  is_feedback            BOOLEAN NOT NULL DEFAULT FALSE,
  is_required            BOOLEAN NOT NULL DEFAULT TRUE,
  visible_nationalities  nationality_type[],
  UNIQUE (version_id, question_code)
);

-- ---------- invitations ----------
-- PII columns are pgcrypto-encrypted ciphertext. Read-only admins access
-- this table through `invitations_redacted` (see 20260519170005); writes go through
-- the base table (Owner-only via RLS in 20260519170004).

CREATE TABLE invitations (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex hash of the plaintext URL token. Plaintext is NEVER
  -- stored: it's generated at issue time, emailed to the recipient,
  -- and hashed before storage. To resend a link, Owner rotates to a
  -- new plaintext token and updates this hash (no way to recover the
  -- original). validate_invitation_token() (20260519170003) hashes its input
  -- and compares against this column.
  token_hash                 TEXT NOT NULL UNIQUE,
  ref_code                   TEXT NOT NULL UNIQUE,
  recipient_name_encrypted   TEXT NOT NULL,
  recipient_email_encrypted  TEXT NOT NULL,
  category                   category_type NOT NULL,
  nationality                nationality_type,
  -- EN/AR language seed for the respondent. The /r/[token] handler
  -- sets the lang cookie from this value before redirecting to /.
  -- See D30 ("Language: cookie-based, with token-entry fallback").
  preferred_language         TEXT NOT NULL DEFAULT 'en'
                             CHECK (preferred_language IN ('en', 'ar')),
  questionnaire_version_id   UUID NOT NULL REFERENCES questionnaire_versions(id),
  status                     invitation_status NOT NULL DEFAULT 'sent',
  expires_at                 TIMESTAMPTZ NOT NULL,
  use_count                  INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  max_uses                   INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  sent_at                    TIMESTAMPTZ,
  opened_at                  TIMESTAMPTZ,
  started_at                 TIMESTAMPTZ,
  submitted_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                 UUID REFERENCES admins(id),
  CHECK (use_count <= max_uses)
);

-- ---------- responses ----------

CREATE TABLE responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id     UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  language          TEXT NOT NULL CHECK (language IN ('en', 'ar')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  duration_minutes  INT,
  is_locked         BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------- answers ----------
-- word_count is GENERATED STORED so dashboards never recount on read.
-- The empty-text guard avoids array_length(NULL) from regexp_split_to_array.
-- Pattern matches JS-style `text.trim().split(/\s+/)`.

CREATE TABLE answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES questions(id),
  answer_text  TEXT NOT NULL DEFAULT '',
  word_count   INT GENERATED ALWAYS AS (
    CASE
      WHEN length(trim(answer_text)) = 0 THEN 0
      ELSE array_length(regexp_split_to_array(trim(answer_text), '\s+'), 1)
    END
  ) STORED,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (response_id, question_id)
);

-- ---------- consent_records ----------
-- Owner-only (RLS in 20260519170004). PII: signed_name_encrypted.

CREATE TABLE consent_records (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id            UUID NOT NULL UNIQUE
                         REFERENCES responses(id) ON DELETE CASCADE,
  signed_name_encrypted  TEXT NOT NULL,
  signed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audio_consent          BOOLEAN NOT NULL,
  agreed_to_read         BOOLEAN NOT NULL,
  agreed_to_participate  BOOLEAN NOT NULL,
  consent_text_version   TEXT NOT NULL DEFAULT 'v1.0',
  language               TEXT NOT NULL CHECK (language IN ('en', 'ar'))
);

-- ---------- tags ----------

CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('theme', 'stance', 'perspective')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES admins(id)
);

-- ---------- response_tags ----------

CREATE TABLE response_tags (
  response_id  UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  tag_id       UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  applied_by   UUID REFERENCES admins(id),
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (response_id, tag_id)
);

-- ---------- researcher_notes ----------
-- One note per response (response_id is the PK).

CREATE TABLE researcher_notes (
  response_id  UUID PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  note_text    TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES admins(id)
);

-- ---------- recordings ----------
-- Read-only admins access via `recordings_redacted` (20260519170005). Owner-only
-- columns at the redaction layer: audio_storage_path, transcript_original,
-- substitution_key. transcript_anonymized is exposed only when status =
-- 'published' (D16).

CREATE TABLE recordings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id             UUID NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  audio_storage_path      TEXT,
  audio_filename          TEXT,
  audio_duration_seconds  INT,
  audio_size_bytes        BIGINT,
  transcript_original     TEXT,
  transcript_anonymized   TEXT,
  substitution_key        JSONB,
  language                TEXT CHECK (language IN ('en', 'ar')),
  status                  transcript_status NOT NULL DEFAULT 'audio_only',
  uploaded_by             UUID REFERENCES admins(id),
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at            TIMESTAMPTZ
);

-- ---------- notifications ----------

CREATE TABLE notifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_admin_id   UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  type                 notification_type NOT NULL,
  title                TEXT NOT NULL,
  body                 TEXT NOT NULL DEFAULT '',
  href                 TEXT,
  read_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- notification_preferences ----------
-- One row per admin. Defaults track D23 (notification fatigue defaults).

CREATE TABLE notification_preferences (
  admin_id                  UUID PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  submission_inapp          BOOLEAN NOT NULL DEFAULT TRUE,
  submission_email          BOOLEAN NOT NULL DEFAULT TRUE,
  invitation_sent_inapp     BOOLEAN NOT NULL DEFAULT TRUE,
  invitation_sent_email     BOOLEAN NOT NULL DEFAULT FALSE,
  invitation_opened_inapp   BOOLEAN NOT NULL DEFAULT TRUE,
  invitation_opened_email   BOOLEAN NOT NULL DEFAULT FALSE,
  stalled_inapp             BOOLEAN NOT NULL DEFAULT TRUE,
  stalled_email             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_inapp        BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_email        BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_digest             BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- email_templates ----------

CREATE TABLE email_templates (
  id           TEXT PRIMARY KEY
               CHECK (id IN ('invitation', 'reminder1', 'reminderFinal',
                             'thankYou', 'v2Migration')),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  subject_en   TEXT NOT NULL,
  subject_ar   TEXT NOT NULL,
  body_en      TEXT NOT NULL,
  body_ar      TEXT NOT NULL,
  bcc_owner    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES admins(id)
);

-- ---------- audit_log ----------
-- BEFORE INSERT trigger (20260519170003) auto-populates ts/actor_* from the session.
-- Callers pass action / resource / severity / metadata.

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_admin_id  UUID REFERENCES admins(id),
  actor_name      TEXT,
  actor_role      admin_role,
  action          TEXT NOT NULL,
  resource        TEXT NOT NULL DEFAULT '',
  ip              TEXT,
  country         TEXT,
  city            TEXT,
  user_agent      TEXT,
  severity        event_severity NOT NULL DEFAULT 'info',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------- settings ----------
-- Key-value configuration (multiple rows despite SCHEMA.md's "single-row"
-- phrasing — see the multi-key INSERT in the doc and in 20260519170007).

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- backups ----------

CREATE TABLE backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_path  TEXT NOT NULL,
  type          TEXT NOT NULL
                CHECK (type IN ('manual', 'scheduled', 'automatic')),
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES admins(id)
);
