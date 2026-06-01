-- 20260602100001_invitations_token_plaintext_for_reminder_reuse.sql
--
-- D64 STEP 6.5 (Path B locked) — adds `invitations.token_plaintext_encrypted`,
-- a Vault-encrypted copy of the plaintext invitation token. Stored at
-- create time (and re-stored at every resend rotation) so the reminder
-- cron (D64 STEP 7) can decrypt + reuse the EXISTING token in the
-- reminder email — no rotation needed. The original invitation email's
-- link stays alive across the reminder cycle.
--
-- WHY PATH B (vs the rejected Path A: rotate-per-reminder):
-- lib/tokens.ts persists ONLY the SHA-256 hash; the plaintext is
-- discarded after the original mint. To dispatch a reminder with a
-- working CTA URL, EITHER we rotate the token (Path A — kills the
-- original invitation email's link) OR we persist the plaintext at
-- mint (Path B — original link stays alive). The team picked Path B
-- (D64 STEP 7 design pivot).
--
-- SECURITY MODEL — same pattern as recipient_email_encrypted +
-- recipient_name_encrypted (proven since D36):
--   - Vault key (pii_key) lives in Supabase Vault, accessed ONLY by
--     SECURITY DEFINER functions encrypt_pii / decrypt_pii.
--   - The plaintext NEVER appears in the database in cleartext, NEVER
--     in logs, NEVER in audit metadata.
--   - decrypt_pii is granted to `authenticated`, so Owner sessions
--     and the service-role cron both can call it. Read-only admins
--     could call it BUT they'd never have a use case (the cron is the
--     only consumer, and it runs service-role).
--   - The plaintext value goes into the reminder email body's URL
--     scoped to a single loop iteration in the cron; falls out of
--     scope at function return; never logged or persisted elsewhere.
--
-- COLUMN POLICY:
--   - NULLABLE. Pre-D64 invitations (created before this column
--     existed) keep NULL. The cron's candidate query gates on
--     `token_plaintext_encrypted IS NOT NULL`, so pre-D64 rows are
--     excluded from auto-reminders. Sura nudges them manually via
--     resend (which rotates + populates the column).
--   - NO BACKFILL. Same forward-only discipline as STEP 3's
--     sent_at fix — we don't have the plaintext for pre-D64 rows
--     (it was discarded post-mint) and there's no cryptographic
--     path back. Manual resend is the recovery for these rows.
--   - NOT IN invitations_redacted view. Read-only admins have no
--     use case for the encrypted plaintext token, and the redacted
--     view already excludes token_hash by the same reasoning
--     ("identify by ref_code, not by token"). View stays at 21
--     columns (the 3 added in STEP 1's view recreate).
--
-- WRITE SITES — see STEP 6.6:
--   1. createInvitationAction (lib/actions/invitations.ts) — at the
--      same point that token_hash is written. Encrypts the freshly-
--      minted plaintext via encrypt_pii.
--   2. resendInvitationAction (lib/actions/invitations.ts) — at the
--      token rotation point. Encrypts the freshly-minted plaintext.
--      The OLD encrypted blob is overwritten (the OLD plaintext is
--      already dead because token_hash rotated to the new value).
--
-- READ SITES:
--   1. /api/cron/send-reminders (app/api/cron/) — service-role
--      decrypt per row in the dispatch loop, scoped to iteration.
--   2. No other reads. The repo (lib/repos/invitations.ts) does NOT
--      expose this column on the Invitation type — it's a write-only
--      column from the application's perspective, decrypted only by
--      the cron.
--
-- IDEMPOTENT — uses IF NOT EXISTS. Safe to re-apply.
--
-- DEPLOY ORDER (matters): this migration MUST COMMIT before
-- STEP 6.6's code (which writes token_plaintext_encrypted) deploys.
-- Lead-the-code rule, same as STEP 1.

BEGIN;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS token_plaintext_encrypted TEXT NULL;

COMMENT ON COLUMN invitations.token_plaintext_encrypted IS
  'Vault-encrypted plaintext invitation token (encrypted via encrypt_pii). '
  'Stored to enable reminder dispatch without token rotation (D64 STEP 7). '
  'Currently NULL for pre-D64 invitations (the cron skips them — Sura '
  'nudges manually). Written at create-time and rotation-time. Decrypted '
  'via decrypt_pii only by service-role contexts (the reminder cron); '
  'regular admin/respondent flows never need it.';

-- NOT touching invitations_redacted. The view stays at 21 columns;
-- read-only admins identify invitations by ref_code, not by token.

COMMIT;
