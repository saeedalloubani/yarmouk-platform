-- 20260524170001_backup_ro_role.sql
--
-- D27 (automated backup) STEP 1: a dedicated least-privilege backup role for CI.
--
-- WHY (the security premise): the manual backup dumps as `postgres`, which can
-- read the Vault (verified: has_table_privilege('postgres','vault.decrypted_
-- secrets','SELECT') = true). Putting a Vault-capable credential in CI would
-- mean a CI compromise could connect live and read the pii_key -> decrypt PII.
-- So CI must use a credential that CANNOT reach the Vault. This role is it:
-- SELECT on public, and NO grants on the `vault` schema at all.
--
-- ⚠️ BYPASSRLS is REQUIRED (deviation from the first sketch, flagged for review):
-- most public tables have RLS enabled (invitations/responses/answers/...). pg_dump
-- runs with row_security = off; a non-owner, non-BYPASSRLS role would ERROR on
-- those tables -> an incomplete/failed backup. BYPASSRLS lets the dump read ALL
-- rows. It does NOT breach the security premise: BYPASSRLS only bypasses RLS
-- POLICIES on tables the role can already SELECT; it grants NO access to the
-- `vault` schema (that's a separate GRANT the role never receives). The PII
-- columns it reads are still ciphertext — the pii_key lives in Vault, which this
-- role cannot touch. Proven post-apply by the Vault-blind checks.
--
-- NO PASSWORD here (a password in a migration would be committed to the repo).
-- The role is created LOGIN-but-passwordless = inert until the owner sets one
-- out-of-band: ALTER ROLE backup_ro PASSWORD '<strong>';  (Saeed's step — the
-- password then goes only into the BACKUP_DB_URL GitHub secret, never the repo).
--
-- Idempotent: guarded CREATE so a re-run / pre-existing role doesn't error.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_ro') THEN
    CREATE ROLE backup_ro WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      BYPASSRLS;     -- read all rows past RLS for a complete dump (see note)
  END IF;
END
$$;

-- Connect + read the public schema (current + future tables). NOTHING on vault.
GRANT CONNECT ON DATABASE postgres TO backup_ro;
GRANT USAGE ON SCHEMA public TO backup_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_ro;
