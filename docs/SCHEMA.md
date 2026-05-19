# Data Model

This is the canonical schema. Supabase migrations live in `supabase/migrations/`. Every table has RLS enabled — policies summarized at the bottom.

## Conventions

- All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` unless noted.
- Timestamps are `TIMESTAMPTZ` and default to `NOW()` where relevant.
- Use Postgres enums for closed sets (status, role, type).
- Use `*_encrypted TEXT` for column-level encrypted fields (pgcrypto + key in Supabase Vault).
- Soft delete is generally avoided — use `removed_at` only on `admins`.

## Enums

```sql
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

CREATE TYPE invitation_status AS ENUM ('sent', 'opened', 'started', 'submitted', 'expired');

CREATE TYPE category_type AS ENUM ('officials', 'researchers', 'donors', 'ngos');

CREATE TYPE nationality_type AS ENUM ('jordanian', 'syrian', 'not_applicable');

CREATE TYPE transcript_status AS ENUM ('audio_only', 'transcribing', 'transcribed', 'anonymizing', 'published');

CREATE TYPE notification_type AS ENUM ('submission', 'invitation', 'system');

CREATE TYPE event_severity AS ENUM ('info', 'warn', 'alert');
```

## Tables

### `admins`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | TEXT UNIQUE | Login identity |
| name | TEXT | |
| role | admin_role | `owner` or `readonly` |
| status | TEXT | `pending` (invited, not activated), `active`, `removed` |
| invited_at | TIMESTAMPTZ | |
| activated_at | TIMESTAMPTZ | When magic-link first redeemed |
| removed_at | TIMESTAMPTZ | |

### `questionnaire_versions`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| type | questionnaire_type | |
| variant | questionnaire_variant | |
| version_number | INT | 1, 2, 3… |
| status | version_status | Only ONE `active` per variant at a time (enforced by partial unique index, see below) |
| includes_feedback_block | BOOL | TRUE for pilots; controls F1–F4 rendering |
| published_at | TIMESTAMPTZ | |
| closed_at | TIMESTAMPTZ | |
| UNIQUE | (variant, version_number) | |

```sql
-- Enforce one active version per variant at the database level
CREATE UNIQUE INDEX one_active_version_per_variant
  ON questionnaire_versions (variant)
  WHERE status = 'active';
```

### `questions`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| version_id | UUID FK → questionnaire_versions | CASCADE delete |
| question_code | TEXT | `Q1`, `Q2`, … `F1` … |
| order_index | INT | Sort order within the version |
| text_en | TEXT | |
| text_ar | TEXT | |
| is_feedback | BOOL | TRUE for F1–F4 |
| is_required | BOOL | Default TRUE |
| visible_nationalities | nationality_type[] | NULL or empty array = visible to all respondents; otherwise the respondent's nationality must be a member (e.g., `ARRAY['syrian']::nationality_type[]` for Syria-only questions). |
| UNIQUE | (version_id, question_code) | |

### `invitations`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| token | TEXT UNIQUE | URL-safe ~12 chars (e.g., `8K2pXa9bRz`) |
| ref_code | TEXT UNIQUE | Anonymized display ID (e.g., `OFF-J-04`) |
| recipient_name_encrypted | TEXT | pgcrypto-encrypted; Owner only |
| recipient_email_encrypted | TEXT | pgcrypto-encrypted; Owner only |
| category | category_type | |
| nationality | nationality_type | NULL when not applicable |
| questionnaire_version_id | UUID FK | |
| status | invitation_status | |
| expires_at | TIMESTAMPTZ | |
| use_count | INT | Default 0 |
| max_uses | INT | 1 for personalized, >1 for shareable links |
| sent_at, opened_at, started_at, submitted_at | TIMESTAMPTZ | Lifecycle timestamps |
| created_at | TIMESTAMPTZ | |
| created_by | UUID FK → admins | |

### `responses`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| invitation_id | UUID FK → invitations | CASCADE delete |
| language | TEXT | `'en'` or `'ar'` |
| started_at, submitted_at | TIMESTAMPTZ | |
| duration_minutes | INT | |
| is_locked | BOOL | TRUE once submitted; prevents edits |

### `answers`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| response_id | UUID FK | CASCADE delete |
| question_id | UUID FK | |
| answer_text | TEXT | Default `''` |
| word_count | INT GENERATED | Computed from answer_text |
| updated_at | TIMESTAMPTZ | |
| UNIQUE | (response_id, question_id) | |

### `consent_records` (Owner only)

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| response_id | UUID FK UNIQUE | CASCADE delete |
| signed_name_encrypted | TEXT | |
| signed_at | TIMESTAMPTZ | |
| audio_consent | BOOL | |
| agreed_to_read, agreed_to_participate | BOOL | |
| consent_text_version | TEXT | `'v1.0'` by default |
| language | TEXT | |

### `tags`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT UNIQUE | e.g., `mentions-groundwater` |
| category | TEXT | `theme`, `stance`, `perspective` |
| created_at | TIMESTAMPTZ | |
| created_by | UUID FK → admins | |

### `response_tags`

Composite PK `(response_id, tag_id)` mapping table.

| Column | Type |
|---|---|
| response_id | UUID FK CASCADE |
| tag_id | UUID FK CASCADE |
| applied_by | UUID FK → admins |
| applied_at | TIMESTAMPTZ |

### `researcher_notes`

| Column | Type | Notes |
|---|---|---|
| response_id | UUID PK FK | One note per response |
| note_text | TEXT | |
| updated_at | TIMESTAMPTZ | |
| updated_by | UUID FK → admins | |

### `recordings`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| response_id | UUID FK | CASCADE delete |
| audio_storage_path | TEXT | Supabase Storage path; Owner only |
| audio_filename | TEXT | |
| audio_duration_seconds | INT | |
| audio_size_bytes | BIGINT | |
| transcript_original | TEXT | Owner only |
| transcript_anonymized | TEXT | Visible to all admins when status = `published` |
| substitution_key | JSONB | `{"[PERSON_1]": "real name", ...}` — Owner only |
| language | TEXT | |
| status | transcript_status | See pipeline below |
| uploaded_by | UUID FK → admins | |
| uploaded_at, published_at | TIMESTAMPTZ | |

**Pipeline**: `audio_only` → `transcribing` → `transcribed` → `anonymizing` → `published`. Only `published` transcripts count toward stats and get exported to ATLAS.ti.

### `notifications`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| recipient_admin_id | UUID FK | CASCADE delete |
| type | notification_type | |
| title | TEXT | |
| body | TEXT | |
| href | TEXT | Where click navigates |
| read_at | TIMESTAMPTZ | NULL = unread |
| created_at | TIMESTAMPTZ | |

### `notification_preferences`

One row per admin. Boolean toggles for each event × channel (in-app / email).

| Column | Default |
|---|---|
| admin_id (PK) | |
| submission_inapp | TRUE |
| submission_email | TRUE |
| invitation_sent_inapp | TRUE |
| invitation_sent_email | FALSE |
| invitation_opened_inapp | TRUE |
| invitation_opened_email | FALSE |
| stalled_inapp | TRUE |
| stalled_email | TRUE |
| failed_login_inapp | TRUE |
| failed_login_email | TRUE |
| weekly_digest | TRUE |

### `email_templates`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `'invitation'`, `'reminder1'`, `'reminderFinal'`, `'thankYou'`, `'v2Migration'` |
| name | TEXT | Human-readable name |
| description | TEXT | Shown in admin UI |
| subject_en, subject_ar | TEXT | |
| body_en, body_ar | TEXT | Supports variables: `{name}`, `{category}`, `{ref_code}`, `{link}`, `{expiry}`, `{language_link}` |
| bcc_owner | BOOL | If TRUE, BCC the owner email on send |
| updated_at | TIMESTAMPTZ | |
| updated_by | UUID FK → admins | |

### `audit_log` (Owner only)

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| ts | TIMESTAMPTZ | |
| actor_admin_id | UUID FK → admins | NULL for anonymous events (failed logins) |
| actor_name | TEXT | Snapshot in case admin removed later |
| actor_role | admin_role | |
| action | TEXT | Dotted-namespace: `auth.login.success`, `invitation.created`, … |
| resource | TEXT | Human-readable |
| ip, country, city | TEXT | Geo-resolved via MaxMind GeoLite2 |
| user_agent | TEXT | |
| severity | event_severity | `info` / `warn` / `alert` |
| metadata | JSONB | Free-form extras |

**Standard action namespaces** (extend as needed):
- `auth.*` — login.success, login.failed, logout
- `invitation.*` — created, sent, resent, expired
- `response.*` — viewed, exported
- `tag.*` — created, applied, removed
- `questionnaire.*` — created, published, closed
- `recording.*` — uploaded, transcribed, published
- `import.*` — started, succeeded, failed
- `export.*` — generated
- `backup.*` — generated, restored
- `admin.*` — added, removed, role.changed
- `settings.*` — updated

### `settings`

Single-row key-value config.

```sql
-- Pre-populate at migration time:
INSERT INTO settings (key, value) VALUES
  ('retention_period_months', '24'::jsonb),
  ('ethics_approval_ref', '""'::jsonb),
  ('ethics_committee', '""'::jsonb),
  ('ethics_approval_date', 'null'::jsonb),
  ('ethics_approval_expiry', 'null'::jsonb),
  ('public_domain', '"karasneh-research.org"'::jsonb),
  ('sender_email', '"invitations@karasneh-research.org"'::jsonb),
  ('sender_name', '"Sura Karasneh — Yarmouk Study"'::jsonb),
  ('reply_to', '"sjkarasneh24@eng.just.edu.jo"'::jsonb);
```

### `backups`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| filename | TEXT | e.g., `backup-2026-05-18-14-30.yarmoukbackup` |
| size_bytes | BIGINT | |
| storage_path | TEXT | Supabase Storage path; Owner only |
| type | TEXT | `manual`, `scheduled`, `automatic` |
| pinned | BOOL | Pinned backups are not auto-deleted |
| created_at | TIMESTAMPTZ | |
| created_by | UUID FK → admins | |

## Row Level Security (RLS) Policies

Every table has `ENABLE ROW LEVEL SECURITY`. Helper function:

```sql
CREATE FUNCTION current_admin_role() RETURNS admin_role
LANGUAGE sql STABLE AS $$
  SELECT role FROM admins
  WHERE email = (SELECT auth.jwt()->>'email')
    AND status = 'active'
$$;
```

### Owner-only tables (deny Read-only)
- `admins`, `settings`, `audit_log`, `backups`, `consent_records`

```sql
CREATE POLICY "owner_only_select" ON admins
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'owner');
```
(Same pattern for INSERT/UPDATE/DELETE on each owner-only table.)

### Owner-only columns (within otherwise-shared tables)

Use **views** to expose redacted versions to Read-only admins, and grant column-level SELECT on the underlying table only to Owner. Example:

```sql
CREATE VIEW invitations_redacted AS
  SELECT id, token, ref_code,
         NULL::TEXT as recipient_name_encrypted,
         NULL::TEXT as recipient_email_encrypted,
         category, nationality, questionnaire_version_id, status,
         expires_at, use_count, max_uses,
         sent_at, opened_at, started_at, submitted_at,
         created_at, created_by
  FROM invitations;
```

Read-only admins query the view; Owner queries the base table.

Same approach for:
- `recordings` (Read-only excludes `audio_storage_path`, `transcript_original`, `substitution_key`)

### Shared tables (Owner + Read-only)

```sql
CREATE POLICY "admins_can_select" ON responses
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));
```

Mutations (INSERT/UPDATE/DELETE) on responses, answers, tags, response_tags, researcher_notes, questionnaires, questions, email_templates, notification_preferences: Owner only.

### Anonymous access (respondent flow)

No table grants SELECT to anon. All respondent operations go through Edge Functions / API routes that validate the invitation token server-side and use the service-role key.

## TypeScript Types

Generate types directly from Supabase:

```bash
supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Then in code:

```ts
import type { Database } from "@/lib/supabase/database.types";
type Invitation = Database["public"]["Tables"]["invitations"]["Row"];
```

Application-facing types use camelCase. Map at the data-access layer:

```ts
// lib/repos/invitations.ts
function toInvitation(row: Database["public"]["Tables"]["invitations"]["Row"]): Invitation {
  return {
    id: row.id,
    refCode: row.ref_code,
    category: row.category,
    // ...
  };
}
```

## API Shapes

### Public endpoints (anonymous)

```
GET /r/[token]
  → Sets invitation cookie, redirects to /
  → If token invalid/expired/exhausted → /invitation-error

POST /api/public/consent
  Body: { name: string, audioConsent: boolean, language: 'en' | 'ar' }
  → Creates response + consent_record
  → Sets response cookie
  → 200 { responseId }

POST /api/public/answer
  Body: { questionId: string, text: string }
  → Upserts answer
  → 200 { saved: true, updatedAt: string }

POST /api/public/submit
  → Marks response as submitted_at = NOW(), is_locked = TRUE
  → Triggers thank-you email + admin notifications
  → 200 { ok: true }
```

### Admin endpoints (auth required)

Use Server Actions where possible. Route handlers used only for:

```
GET  /api/admin/export/atlas?versionId=...&categories=...
  → Streams .xlsx file

GET  /api/admin/export/dashboard/[id]?format=png|pdf|docx
  → Server-side snapshot generation

POST /api/admin/backup/generate
  → Async job, returns { backupId }
  → On completion, notifies owner

POST /api/admin/backup/restore
  Body: multipart/form-data, .yarmoukbackup file
  → Validates checksum, archives current state, restores
```

All other admin actions use Next.js Server Actions colocated with their UI components.
