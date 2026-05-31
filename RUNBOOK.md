# Operations Runbook

Manual steps a human runs outside the codebase — Vault key setup, key rotation, disaster recovery, admin auth bootstrap. Migrations and scripts handle everything else. Decision rationale for these operations lives in `docs/DECISIONS.md` (D36 covers the Vault model; D4 covers what's encrypted and why; D49/D50/D51 cover admin auth).

## Admin auth bootstrap (Session 3a)

Migrations seed the `admins` allow-list **row** (app-level role data), but do NOT create Supabase Auth identities. Provision those by hand in the dashboard. Per D49, signup is locked down — only pre-created identities can ever sign in.

**One-time dashboard steps:**

1. **Disable signups.** Authentication → Sign In / Providers → turn **"Allow new users to sign up" OFF**. (Belt-and-suspenders with `shouldCreateUser:false` in the login code.)
2. **Pre-create the admin identity.** Authentication → Users → **Add user** → `sjkarasneh24@eng.just.edu.jo`, **auto-confirm**. Dashboard "Add user" bypasses the signup toggle, so step 1 and step 2 are order-independent — what matters is that the user **exists before first login** (with `shouldCreateUser:false`, login can't create it). Supervisors (two readonly admins) are added the same way in Session 3b once their emails are known, and seeded into `admins` by that session's migration.
3. **Redirect URLs.** Authentication → URL Configuration → Redirect URLs → add `http://localhost:3000/admin/callback` and `https://karasneh-research.org/admin/callback` (plus the Vercel preview URL if previews are used).

After these: `npm run dev`, go to `/admin/login`, enter the email, click the magic link → `/admin/callback` exchanges it → `/admin` shows "Signed in as Sura Karasneh (owner)".

**PKCE fallback (only if the magic link fails at `/admin/callback`):**

The default email template uses a `?code=` link that the callback exchanges via `exchangeCodeForSession`. `@supabase/ssr` stores the PKCE code-verifier in a cookie shared with the server callback; if that cookie isn't present for some flow, the exchange fails and the user is bounced to `/admin/login?error=auth`. The fix (no code-verifier needed):

1. Authentication → Email Templates → **Magic Link**: change the link to
   `{{ .SiteURL }}/admin/callback?token_hash={{ .TokenHash }}&type=email`
2. In `app/admin/callback/route.ts`, read `token_hash` + `type` and call
   `await supabase.auth.verifyOtp({ type, token_hash })` instead of `exchangeCodeForSession(code)`.

Build/keep the code-exchange path first; switch only if smoke fails. (Also noted in the callback route comment.)

## Reading invitation-send failures (Session 3b-ii)

When a resend (`resendInvitationAction`) returns `emailed: false`, the UI shows the loud red panel with the new link — but the *cause* lives only in the dev/prod server log, and the two causes mean very different things. Check **which `console.error` fired** in `lib/actions/invitations.ts` / `lib/email/invitation.ts`:

- **`[invitations] resend decrypt_pii failed`** → a **Vault/key sev-1**. `decrypt_pii` couldn't read the recipient address, which means the encryption key path is broken — and that breaks **every PII read app-wide** (consent names, invitation names/emails, future exports). Stop and treat as a key-access incident (see "Disaster recovery: lost encryption key" below). The token *did* rotate (old link dead), so hand off the panel's `tokenUrl` manually, then fix the key path.
- **`[email] invitation send failed/threw for <refCode>`** → a **transient Resend issue** (API down, rate limit, or — in test mode — recipient isn't the verified account address). Recoverable: resend again once Resend is healthy, or hand off the panel's `tokenUrl`. Not a data-integrity problem.

Same user-facing surface (loud panel + `tokenUrl`), very different operational severity. The log line is how you tell them apart.

## Revoking an invitation (owner-driven terminal kill)

The owner can revoke any non-submitted invitation from `/admin/invitations` — Revoke button beside Resend, owner-only, both hidden once a row is terminal (`status='submitted'` or `status='revoked'`). Revoke is the right tool when:

- The invitation went to the wrong recipient (typo, wrong person).
- The recipient is no longer eligible (withdrew interest, ineligible per the recruitment criteria).
- A security concern (link suspected leaked or shared beyond the intended recipient).

### What revoke does (three ops, atomic by effect — D61)

1. **Kills the magic link.** `token_hash` rotates to a freshly-minted hash whose plaintext is discarded — no one (including the owner) can ever produce a URL that validates against it. The old `/r/<token>` URL stops working immediately and redirects to `/invitation-invalid` on any future click.
2. **Sets `status='revoked'`.** The row's chip flips to the danger styling (`bg-dangerLight text-danger`). Resend and Revoke both vanish on the row (terminal state).
3. **Locks any in-progress response.** If the recipient already clicked the link and started answering, `responses.is_locked` flips to `TRUE`. Their session is invalid at the next page load (`getSession()` returns `null` → bounces them to landing).

### What revoke does NOT do

- **Saved answers are retained.** A respondent's in-progress answers are NOT deleted — `is_locked` is a gate flag, not a CASCADE. The owner still reads them via `/admin/responses/<id>`. *If you want to delete the data too, that's "withdraw response", a separate operation tied to consent withdrawal — not built yet; for now do it via Studio `DELETE FROM responses WHERE id='<id>'` (CASCADE wipes answers).*
- **Not reversible.** Revoke is terminal. To re-invite, create a fresh invitation; pick a new `ref_code` (the original code is now permanently taken by the revoked row).
- **Does not email anything.** No notification to the recipient — they simply find the old link dead next time they click. (If you want them informed, send a manual email out-of-band.)

### The block-then-confirm gate (the in-progress case)

If the recipient is mid-flow (a response exists with `submitted_at IS NULL`), the first revoke click hits a UI gate. After the generic "Revoke X?" confirm, a SECOND confirmation fires with the honest wording:

> "X has started answering. Revoking will lock them out of continuing — their saved answers are retained and visible to you, but they cannot add more or submit. The magic link will also stop working. Continue?"

Read it carefully — the wording matches reality. The kick is silent from the respondent's side (their next page load bounces them to landing, no terminal page that says "your invitation was revoked"). Click through only if the kick is intentional.

### Handling a misdirected real invitation

1. Open `/admin/invitations`.
2. Find the row by `ref_code`. **Confirm it's the wrong one before clicking Revoke** — the action is terminal, no undo.
3. Click **Revoke**. First confirm: read + OK.
4. If the recipient already clicked: the second honest confirm fires. Read + OK (or cancel if you'd rather let them submit).
5. The row flips to `status=revoked` with the danger chip; both action buttons vanish.
6. To send to the correct recipient: `/admin/invitations/new`, pick a fresh `ref_code` (the original is taken by the revoked row).
7. Audit row appears at `/admin/security` as `invitation.revoke` (severity=warn) with `hadInProgressResponse` + `lockedResponseIds` metadata.

### Stale-tab self-correction

If two admin tabs both show the same invitation as revocable and one revokes it, the other tab will surface `already_revoked` on the next click and **auto-refresh** to the canonical terminal state (chip flips, buttons vanish). No manual reload needed. This is intentional — when the app knows the display is stale, it self-corrects rather than instructing the user.

## First-time setup: Vault keys

Required before applying any migration that references `pii_key_v*`. Without this, `decrypt_pii` finds no key in Vault and PII reads/writes fail.

1. Generate a 32-byte key:
   ```
   openssl rand -base64 32
   ```
2. Copy the output (a ~44-character base64 string).
3. Supabase Studio → **Vault** (left sidebar; under "Project Settings" in some versions) → **Add new secret**.
4. Set:
   - **Name**: `pii_key_v1`
   - **Secret**: paste the openssl output
   - **Description**: `pgcrypto key for PII columns (recipient_*_encrypted, signed_name_encrypted). See DECISIONS.md D36.`
5. Save.
6. Verify in SQL Editor:
   ```sql
   SELECT name, decryptable FROM vault.decrypted_secrets WHERE name = 'pii_key_v1';
   ```
   Expect one row, `decryptable = true`.
7. **Store the same key in your password manager**, labelled `Yarmouk — pii_key_v1 (active)`. This is the only backup. See "Disaster recovery" below for why this step matters.

## Key rotation: pii_key_v(N+1)

Run when a key needs to be retired (suspected compromise, scheduled rotation, or any time the active key has been exposed somewhere it shouldn't have been).

1. Generate the new key: `openssl rand -base64 32`.
2. In Vault, add it as `pii_key_v(N+1)` (e.g., `pii_key_v2`). **Do not delete the previous key.** `decrypt_pii` falls back to older versions for ciphertext written under them.
3. Update the password manager:
   - Add new entry: `Yarmouk — pii_key_v(N+1) (active)`
   - Re-label the previous: `Yarmouk — pii_key_v(N) (previous, still required for old ciphertext)`
   - Keep both entries.
4. New PII writes will automatically use the highest version. Old reads continue to work via the fallback path.
5. *(Optional, recommended after a few weeks)* Backfill: an Owner-only maintenance script re-encrypts existing rows under the new key. Once verified, delete `pii_key_v(N-1)` from Vault and re-label the password-manager entry `Yarmouk — pii_key_v(N-1) (retired, safe to delete)`.
6. Run the encrypt/decrypt smoke-test query against a known sample row to confirm the rotation didn't break anything.

## Disaster recovery: lost encryption key

If the active Vault key is deleted from Vault, **don't generate a replacement under the same name yet** — a new key won't decrypt data written under the old key, and creating a same-named key would mask the loss rather than fix it.

**Step 1 — Check the backup first.** The password manager should contain an entry named `Yarmouk — pii_key_v1 (active)` (or whichever version is current). If it's there:

- Add it back to Vault under its original name.
- Re-run the verification query: `SELECT decryptable FROM vault.decrypted_secrets WHERE name = 'pii_key_v1';` — expect `true`.
- Confirm by decrypting a known sample row. PII is readable again. No further action required.

**Step 2 — If the password manager copy is also missing**, consider any offline backups (encrypted USB, paper copy in a safe). The key is a 44-character string; if it was ever written down or exported, it's still recoverable.

**Step 3 — If the key is truly unrecoverable**, here is what that means in concrete terms:

**What's permanently unreadable:**
- `recipient_name_encrypted` and `recipient_email_encrypted` on the `invitations` table
- `signed_name_encrypted` on the `consent_records` table

**What is *not* affected** (the platform keeps working):
- `ref_code` on each invitation — the anonymized display ID is plaintext and was never encrypted.
- The entire analytical dataset: `questions`, `responses`, `answers`, `response_tags`, `researcher_notes`, `recordings.transcript_anonymized` (when published), `audit_log`.
- Settings, the questionnaire content, tags, and every dashboard view.

**Methodologically**, the thesis defense data is intact. The analytical dataset is anonymized by design (D4) — analysis never depended on the encrypted columns. Losing PII means losing the operational ability to identify which invitation went to which person, not losing any research finding. If new invitations need to be sent (e.g., to continue data collection), generate fresh tokens with fresh PII; the existing analytical data is unaffected and still attributable to its ref_code.

**Then**, and only then, add a new key (`pii_key_v2`) and update the password manager. Existing ciphertext stays unreadable; new writes work normally.

## Backup & restore

Encrypted, DB-only. Two paths coexist:

- **Automated daily backup (D27 — live since 2026-05-27, restore-proven).** A
  GitHub Actions workflow dumps as `backup_ro` (Vault-blind), encrypts, and
  uploads to Cloudflare R2 every day at 03:00 UTC. This is the durable
  data-loss guarantee. See "Rehearsed restore — CI-produced blob" below.
- **Manual on-demand backup.** `npm run backup` — the runbook for ad-hoc
  rehearsals, milestone snapshots before risky operations, and any moment
  you want a fresh blob NOW rather than waiting for the cron. Stays useful
  as the FLOOR even though the cron is the durable fix.

Free-tier Supabase provides **no** platform backups, so these two paths are
the recovery path (see "Limitations" below for what's still v1-scope).

### How to back up

    npm run backup

Produces `backups/yarmouk-YYYYMMDD-HHMM.yarmoukbackup` — an encrypted archive
(`supabase db dump --linked` schema + data → `tar.gz` → `openssl enc
-aes-256-cbc -pbkdf2`). The `backups/` dir is **gitignored and project-local**.

**Then copy it OFFSITE** to Saeed's Mac backup location. The project-local
`backups/` dir is **not** an offsite copy — a disk loss takes the repo and the
backup together. Run a backup **before any significant operation** (migration,
V2 publish, bulk change) and **periodically once real data exists**.

### During-collection backup routine

D27's daily cron (03:00 UTC, encrypted blob to R2) is the durable data-loss
guarantee. This manual routine is no longer the floor — it's a SUSPENDERS
to the cron's belt: useful when you want a fresh blob BEFORE/AFTER a
milestone (rather than waiting for the next 03:00 UTC), or to keep a local
copy on Saeed's Mac as an extra offsite layer.

- **Who:** the Owner (Saeed during dev hand-off; Sura once sole researcher).
- **When (optional, not required):** immediately before/after a milestone
  (activating a variant, closing a variant, a bulk invitation send). The
  daily cron already covers the steady-state daily floor.
- **Each run:** `npm run backup` → copy the new `.yarmoukbackup` **offsite**
  (see "How to back up" above) → keep the three secrets separate (see "The three
  secrets" below).
- **Retention (manual blobs):** keep the milestone snapshots; the R2-side
  30-day rolling lifecycle handles the daily-cron blobs.

To recover, see "Restore" below.

### The three secrets (a backup is useless without ALL THREE — stored SEPARATELY)

1. **The `.yarmoukbackup` file** — the encrypted dump (keep offsite).
2. **`BACKUP_PASSPHRASE`** — password manager: **"Yarmouk — BACKUP_PASSPHRASE"**.
   Decrypts the archive. **If lost, the file is permanently unrecoverable** (D28)
   — there is no recovery path for a forgotten passphrase.
3. **Vault key `pii_key_v1`** — password manager: **"Yarmouk — pii_key_v1
   (active)"**. Decrypts the PII columns. Without it the analytical data restores
   fine, but `recipient_name_encrypted` / `recipient_email_encrypted`
   (invitations) and `signed_name_encrypted` (consent_records) stay unreadable
   ciphertext. See "Disaster recovery: lost encryption key" above.

Keep them apart — the file offsite, the two secrets in the password manager. No
single loss should both expose readable PII and destroy recoverability.

### What's IN / NOT IN the backup

**IN** — the `public` schema: **all 17 tables (structure + data)**. PII columns
are included **as ciphertext** (readable only with the Vault key).

**NOT IN** (recovered separately):
- **The Vault key** — managed `vault` schema; never dumped. Reinstate from the
  password manager.
- **`auth.users`** (admin login identities) — managed `auth` schema;
  re-provision per "Admin auth bootstrap" above.
- **Storage objects / recordings audio** — live in Storage, not the DB. Empty
  now (text-first); **add a Storage backup step here when interviews start
  being recorded.**
- **Supabase-managed roles / schemas / RLS-policy grants** — recreated by the
  platform + `supabase db push` (from migrations), not by this dump.

### Restore — VERIFIED data round-trip (proven 2026-05-24)

The conservative worst case we actually exercised: restore into a **bare**
throwaway Postgres and confirm the public data comes back.

    # 1. Decrypt + untar into a temp dir (BACKUP_PASSPHRASE from .env.local; never echo it)
    TMP="$(mktemp -d)"
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -in backups/yarmouk-YYYYMMDD-HHMM.yarmoukbackup \
      -pass env:BACKUP_PASSPHRASE | tar -xzf - -C "$TMP"
    #   → $TMP/schema.sql + $TMP/data.sql

    # 2. Throwaway postgres:17 (matches live PG major)
    docker run -d --name yarmouk-restore-test -e POSTGRES_PASSWORD=test postgres:17
    until docker exec yarmouk-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

    # 3. Restore schema, then data (continue past benign errors)
    docker exec -i yarmouk-restore-test psql -U postgres -v ON_ERROR_STOP=0 < "$TMP/schema.sql"
    docker exec -i yarmouk-restore-test psql -U postgres -v ON_ERROR_STOP=0 < "$TMP/data.sql"

    # 4. Verify count(*) per table vs live — expect every one to match
    docker exec yarmouk-restore-test psql -U postgres -tA -c "
    select 'admins',count(*) from admins
    union all select 'answers',count(*) from answers
    union all select 'audit_log',count(*) from audit_log
    union all select 'backups',count(*) from backups
    union all select 'consent_records',count(*) from consent_records
    union all select 'email_templates',count(*) from email_templates
    union all select 'invitations',count(*) from invitations
    union all select 'notification_preferences',count(*) from notification_preferences
    union all select 'notifications',count(*) from notifications
    union all select 'questionnaire_versions',count(*) from questionnaire_versions
    union all select 'questions',count(*) from questions
    union all select 'recordings',count(*) from recordings
    union all select 'researcher_notes',count(*) from researcher_notes
    union all select 'response_tags',count(*) from response_tags
    union all select 'responses',count(*) from responses
    union all select 'settings',count(*) from settings
    union all select 'tags',count(*) from tags"
    #   Compare against live: supabase db query --linked with the same query.

    # 5. Tear down
    docker rm -f yarmouk-restore-test ; rm -rf "$TMP"

**Expected-benign errors** (NOT failures): `role "…" does not exist`
(Supabase-managed roles — `supabase_admin`, `authenticated`, `anon`,
`service_role`), `schema "auth"/"storage" does not exist`, `extension
"supabase_vault" is not available`, `publication "supabase_realtime" does not
exist`, and `COPY`-cascade `syntax error` / `trailing junk` lines from those
missing-schema blocks. **Only public-schema success matters** — confirm all 17
tables exist with matching row counts. (2026-05-24: all 17 matched; no error
touched the public schema.)

### Rehearsed restore — CI-produced blob (proven 2026-05-27)

The full procedure exercised against an actual D27 CI-produced blob from
R2. **This is the emergency runbook** for the durable backup path: download
the most recent blob from R2, restore to a throwaway `postgres:17`, and
verify counts against live. Step-exact — vanilla `postgres:17` will NOT
restore clean without the role + cross-schema stubs in step 5.

**Prerequisites on the machine you restore from:** `docker` (daemon
running), `openssl` (any 3.x), `psql` (any version ≥ 14 — restoring plain
SQL is forward-compatible). Plus the three secrets, each from its
separate store (see "The three secrets" above).

#### 1. Download the most recent blob from R2

Cloudflare dashboard → R2 → `yarmouk-backups` bucket → click the
top-of-list `yarmouk-YYYYMMDD-HHMM.yarmoukbackup` (newest by timestamp) →
Download. Place at any local path; this runbook assumes
`~/Downloads/yarmouk-YYYYMMDD-HHMM.yarmoukbackup`.

(CLI alternative: `aws --endpoint-url $R2_ENDPOINT s3 cp s3://yarmouk-backups/<name> ./`
with R2 creds temporarily in env. The UI path is preferred — keeps R2
write/list creds off the recovering machine.)

#### 2. Write the passphrase to a 0600 file (we use `openssl -pass file:`)

Use `printf` (not `echo`) so there's no trailing newline — a stray `\n`
flips the passphrase by one byte and decrypt silently fails:

    printf '%s' '<the BACKUP_PASSPHRASE>' > ~/.restore-proof.passphrase
    chmod 600 ~/.restore-proof.passphrase
    # Quick sanity (does NOT print the value):
    wc -c ~/.restore-proof.passphrase
    # byte count must equal passphrase length EXACTLY (+1 = trailing newline)

#### 3. Decrypt + extract

    mkdir -p /tmp/restore-proof
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -pass file:$HOME/.restore-proof.passphrase \
      -in $HOME/Downloads/yarmouk-YYYYMMDD-HHMM.yarmoukbackup \
      -out /tmp/restore-proof/dump.tar.gz
    tar -xzf /tmp/restore-proof/dump.tar.gz -C /tmp/restore-proof/
    # → /tmp/restore-proof/schema.sql + /tmp/restore-proof/data.sql

Decrypt failure here means the local passphrase file diverged from the
GitHub `BACKUP_PASSPHRASE` secret used by CI at encryption time. Fix both
to match, re-dispatch the workflow to produce a new blob, retry.

#### 4. Spin throwaway `postgres:17`

    docker run --rm -d --name yarmouk-restore-proof \
      -e POSTGRES_PASSWORD=throwaway -p 55432:5432 postgres:17
    until docker exec yarmouk-restore-proof pg_isready -U postgres -q; do sleep 1; done

#### 5. Pre-seed cross-schema + role stubs — REQUIRED

Vanilla `postgres:17` lacks the Supabase-provided `authenticated` role and
the `auth` / `vault` / `extensions` schemas the public-schema dump
references. Without these stubs, schema apply throws ~50 errors on RLS
policies + GRANTs (silently skipped → a restored DB with no RLS, a real
correctness gap if you trusted it). Apply BEFORE `schema.sql`:

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=on <<'SQL'
    CREATE ROLE authenticated;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS vault;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (id UUID PRIMARY KEY, name TEXT, decrypted_secret TEXT);
    CREATE OR REPLACE FUNCTION auth.uid()  RETURNS UUID  LANGUAGE sql AS $$ SELECT NULL::UUID  $$;
    CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS JSONB LANGUAGE sql AS $$ SELECT NULL::JSONB $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT  LANGUAGE sql AS $$ SELECT NULL::TEXT  $$;
    SQL

Runtime behavior of these stubs returns NULL — fine, since this restore-
proof is count-verify, not RLS / encryption exercise.

#### 6. Apply schema with errors-don't-stop; classify any error

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres \
      -v ON_ERROR_STOP=off \
      -f /tmp/restore-proof/schema.sql \
      2> /tmp/restore-proof/schema-apply.stderr
    grep -E 'ERROR' /tmp/restore-proof/schema-apply.stderr \
      | sed 's/.*ERROR:  //' | sort | uniq -c

Expected after stubs: **exactly one benign error** — `schema "public"
already exists` (postgres:17 ships `public`; dump's `CREATE SCHEMA public`
is redundant; a real Supabase restore target also has it). Anything else
is a real signal — likely a stub gap from a new Supabase role/schema
referenced upstream.

#### 7. Apply data with FK deferral (`session_replication_role = replica`)

The `admins.id → auth.users(id)` FK has no target rows in our empty stub
`auth.users`. Without deferral, the COPY would FK-fail and admins rows
would silently NOT load — a false-pass risk on a count-verify. Use the
standard pg_restore idiom:

    (
      echo "SET session_replication_role = replica;"
      cat /tmp/restore-proof/data.sql
      echo "SET session_replication_role = origin;"
    ) | PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres \
          -v ON_ERROR_STOP=off \
          2> /tmp/restore-proof/data-apply.stderr
    grep -E 'ERROR' /tmp/restore-proof/data-apply.stderr | sed 's/.*ERROR:  //' | sort | uniq -c

Expected: ZERO errors. The orphan `admins.id → empty auth.users` FK is
expected and explained — Supabase's `auth` schema is managed separately
and populated by re-provisioning admins in a real restore target.

#### 8. Count-verify against live — JOIN BY NAME (not paste-by-line)

In Supabase Studio → SQL Editor, run the live UNION:

    SELECT 'admins'                  AS t, COUNT(*)::int FROM admins
    UNION ALL SELECT 'answers',                COUNT(*)::int FROM answers
    UNION ALL SELECT 'audit_log',              COUNT(*)::int FROM audit_log
    UNION ALL SELECT 'backups',                COUNT(*)::int FROM backups
    UNION ALL SELECT 'consent_records',        COUNT(*)::int FROM consent_records
    UNION ALL SELECT 'email_templates',        COUNT(*)::int FROM email_templates
    UNION ALL SELECT 'invitations',            COUNT(*)::int FROM invitations
    UNION ALL SELECT 'notification_preferences', COUNT(*)::int FROM notification_preferences
    UNION ALL SELECT 'notifications',          COUNT(*)::int FROM notifications
    UNION ALL SELECT 'questionnaire_versions', COUNT(*)::int FROM questionnaire_versions
    UNION ALL SELECT 'questions',              COUNT(*)::int FROM questions
    UNION ALL SELECT 'recordings',             COUNT(*)::int FROM recordings
    UNION ALL SELECT 'researcher_notes',       COUNT(*)::int FROM researcher_notes
    UNION ALL SELECT 'response_tags',          COUNT(*)::int FROM response_tags
    UNION ALL SELECT 'responses',              COUNT(*)::int FROM responses
    UNION ALL SELECT 'settings',               COUNT(*)::int FROM settings
    UNION ALL SELECT 'tags',                   COUNT(*)::int FROM tags
    ORDER BY t;

Save the result as `/tmp/restore-proof/live.csv` (one `table,count` per
line). Same UNION against the restored DB:

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres -t -A -F',' -c \
      "<same UNION>" > /tmp/restore-proof/restored.csv

Diff JOIN-BY-NAME (NOT paste-by-line — postgres `ORDER BY` is
locale-aware; the alphabetic order of `response_tags` vs `responses`
differs between byte-order and en_US.UTF-8 collation, so a line-paste
diff produces FALSE mismatches):

    join -t',' <(sort /tmp/restore-proof/live.csv) <(sort /tmp/restore-proof/restored.csv) \
      | awk -F',' '{ printf "%-25s %4d %4d  %s\n", $1, $2, $3, ($2==$3?"✓":"✗ MISMATCH") }'
    # Set-completeness sanity:
    diff <(cut -d',' -f1 live.csv | sort) <(cut -d',' -f1 restored.csv | sort)

**Pass condition:** all 17 tables match. A mismatch on any table — even a
zero-table going non-zero, or a non-zero coming up short — is a real
finding and must be chased, NOT waved away.

#### 9. Teardown

    docker rm -f yarmouk-restore-proof
    rm -rf /tmp/restore-proof
    rm ~/.restore-proof.passphrase     # passphrase footprint back to zero

#### Last full rehearsal

2026-05-27 — CI-produced blob `yarmouk-20260526-1709.yarmoukbackup` (20.86 KB).
Decrypt: OK. Schema apply: 1 benign error (`schema "public" already exists`).
Data apply: 0 errors. Count diff: all 17 tables matched (98 rows across 6
non-zero tables: admins=3, audit_log=19, email_templates=1, questionnaire_versions=9,
questions=57, settings=9). D27 STEP 4 closed.

### Full disaster recovery (DOCUMENTED — NOT yet rehearsed end-to-end)

A real recovery targets a **Supabase project** (new or reset), where the managed
roles / schemas / RLS already exist — so the benign bare-postgres errors above
don't occur. Outline:

1. **Provision the target** — a fresh Supabase project, or reset the existing
   one. *(Mind the 2-project free-tier limit.)*
2. **Recreate schema + RLS + roles** — `supabase db push` from
   `supabase/migrations/` (authoritative), **or** restore the `schema.sql` layer.
3. **Restore public data** — load `data.sql` from the decrypted backup.
4. **Re-provision auth identities** — recreate the admin `auth.users` per "Admin
   auth bootstrap" above (`admins` rows + dashboard auth users, reconciled ids).
5. **Reinstate the Vault key** — add `pii_key_v1` from the password manager per
   "Disaster recovery: lost encryption key" above, so PII decrypts.
6. **Re-link the CLI** — `supabase link --project-ref <ref>`.

**Honesty marker:** the **DATA round-trip is PROVEN** twice — 2026-05-24
(manual-blob count-verify) and 2026-05-27 (CI-blob from R2, full procedure
with stubs + `session_replication_role` deferral, see "Rehearsed restore"
above). The **full project-level DR above is DOCUMENTED but NOT yet
rehearsed end-to-end** — rehearse it before relying on it (a future
exercise; dry-run against a scratch project when one is free).

### Limitations (v1 scope)

- **DB-only** — no Storage / audio (text-first; add when interviews are recorded).
- **Free-tier Supabase has no platform backups** — which is why this exists.
  The D27 daily cron + manual `npm run backup` are the only backup paths.
- **Recordings bucket NOT in dump** — Stage 2 item; add a Storage download step
  to the workflow when interviews start being recorded.
