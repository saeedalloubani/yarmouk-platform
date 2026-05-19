-- 20260519170010_pii_encryption_helpers.sql
--
-- pgcrypto-based encrypt/decrypt helpers for PII columns, with the
-- encryption key sourced from Supabase Vault (per D36).
--
-- Both functions are SECURITY DEFINER so they can read
-- vault.decrypted_secrets on behalf of callers without granting Vault
-- access to authenticated. search_path is locked down per D38;
-- pgcrypto calls qualified with `extensions.` per D38; Vault table
-- aliased per D39 (even though no RETURNS TABLE collision here, the
-- convention is "no exceptions").
--
-- Audience: lib/encryption.ts (Session 2b-2) calls these via
-- supabase.rpc() from Owner-authenticated server contexts. Anon never
-- encrypts or decrypts — public flow writes go through Server Actions
-- that pre-encrypt before insert, run under service_role.
--
-- Key versioning (D36):
-- - Secrets in Vault named pii_key_v1, pii_key_v2, ... (operationally
--   managed via Studio; see RUNBOOK.md).
-- - encrypt_pii uses the highest-version key. Integer-sorted (NOT
--   lexical — "pii_key_v10" sorts after "pii_key_v2" only if we cast
--   the suffix to INT). Malformed names filtered via regex WHERE.
-- - decrypt_pii tries highest-version first, falls back to lower
--   versions in order. If all keys fail to decrypt, raises rather
--   than returning NULL — silent decryption failure would mask data
--   corruption.
--
-- NULL handling: both functions return NULL when given NULL input.
-- This distinguishes "no value" (NULL ciphertext, no PII recorded)
-- from "empty value" (a non-NULL ciphertext that decrypts to '').
--
-- Empty-string handling: encrypt_pii('') produces a non-NULL
-- ciphertext (pgp_sym_encrypt accepts empty input and produces
-- ~80 bytes of overhead). decrypt_pii roundtrips it back to ''.
--
-- EXCEPTION class selection (verified via SQLSTATE probe in Studio
-- before this migration was written):
--   - pgp_sym_decrypt raises SQLSTATE 39000 for both wrong-key and
--     corrupt-ciphertext (pgcrypto deliberately conflates these for
--     information-hiding). Named alias for class 39 is
--     external_routine_invocation_exception (NOT external_routine_exception
--     — that's class 38, a different category).
--   - decode() raises SQLSTATE 22023 (invalid_parameter_value) for
--     invalid base64 input.
--   - Any other error (Vault NULL, permission denied, OOM) propagates
--     and aborts the rotation-fallback loop — that's deliberate; those
--     are infrastructure failures we want visible, not silently retried.

-- ---------- encrypt_pii ----------

CREATE OR REPLACE FUNCTION public.encrypt_pii(p_plaintext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key_name TEXT;
  v_key      TEXT;
BEGIN
  IF p_plaintext IS NULL THEN
    RETURN NULL;
  END IF;

  -- Highest-version pii_key_v* from Vault. Regex WHERE excludes any
  -- malformed names so they don't sort to the top with NULL versions.
  -- Integer cast on the suffix forces correct numeric ordering.
  SELECT s.name, s.decrypted_secret
    INTO v_key_name, v_key
    FROM vault.decrypted_secrets AS s
   WHERE s.name ~ '^pii_key_v\d+$'
   ORDER BY substring(s.name from 'pii_key_v(\d+)$')::INT DESC
   LIMIT 1;

  IF v_key_name IS NULL THEN
    RAISE EXCEPTION 'encrypt_pii: no pii_key_v<N> secret found in Vault';
  ELSIF v_key IS NULL THEN
    RAISE EXCEPTION 'encrypt_pii: secret % exists but decrypted_secret is NULL', v_key_name;
  END IF;

  -- Ciphertext overhead: ~80 bytes minimum (header + IV + MAC)
  -- even for empty plaintext. Account for this when reasoning
  -- about column sizes and table bloat.
  RETURN encode(extensions.pgp_sym_encrypt(p_plaintext, v_key), 'base64');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.encrypt_pii(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_pii(TEXT) TO authenticated;

-- ---------- decrypt_pii ----------

CREATE OR REPLACE FUNCTION public.decrypt_pii(p_ciphertext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key       TEXT;
  v_decrypted TEXT;
  v_last_err  TEXT;
  v_any_key   BOOLEAN := FALSE;
BEGIN
  IF p_ciphertext IS NULL THEN
    RETURN NULL;
  END IF;

  -- Loop terminates on first success or after all keys tried.
  -- With N keys, worst case is N pgp_sym_decrypt calls per
  -- failed decrypt. At expected N≤3 (one active + up to two
  -- retired pending backfill), this is fine. Revisit if N grows.
  FOR v_key IN
    SELECT s.decrypted_secret
      FROM vault.decrypted_secrets AS s
     WHERE s.name ~ '^pii_key_v\d+$'
     ORDER BY substring(s.name from 'pii_key_v(\d+)$')::INT DESC
  LOOP
    v_any_key := TRUE;
    BEGIN
      v_decrypted := extensions.pgp_sym_decrypt(
        decode(p_ciphertext, 'base64'),
        v_key
      );
      RETURN v_decrypted;
    EXCEPTION
      WHEN external_routine_invocation_exception  -- SQLSTATE 39xxx (incl 39000): wrong key OR corrupt ciphertext
        OR invalid_parameter_value                -- SQLSTATE 22023: invalid base64 input
      THEN
        v_last_err := SQLERRM;
        -- continue to next key
    END;
  END LOOP;

  IF NOT v_any_key THEN
    RAISE EXCEPTION 'decrypt_pii: no pii_key_v<N> secret found in Vault';
  END IF;

  RAISE EXCEPTION 'decrypt_pii: no key in Vault could decrypt the input (last error: %)', v_last_err;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrypt_pii(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_pii(TEXT) TO authenticated;
