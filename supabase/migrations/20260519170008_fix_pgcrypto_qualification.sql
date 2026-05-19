-- 20260519170008_fix_pgcrypto_qualification.sql
--
-- Fixes pgcrypto function resolution inside validate_invitation_token.
--
-- pgcrypto is installed in the `extensions` schema on Supabase projects
-- (not `public`). The function declares `SET search_path = public,
-- pg_temp` — `extensions` is deliberately NOT on that list because
-- locking down search_path is a SECURITY DEFINER hygiene requirement.
-- Result: an unqualified `digest(...)` call can't resolve and fails at
-- execution. The bug is invisible at CREATE TIME because PL/pgSQL
-- compiles function bodies lazily (parse-time check is name + arity
-- only, not symbol resolution).
--
-- Fix: qualify as `extensions.digest(...)`. Same pattern applies to any
-- pgcrypto call we add later — pgp_sym_encrypt / pgp_sym_decrypt in the
-- Session 2b encrypt_pii / decrypt_pii helpers per D36 must also be
-- qualified with `extensions.`. See D38 for the convention + audit grep.
--
-- Pre-write audit confirmed:
--   - This is the only unqualified pgcrypto call in any migration.
--   - gen_random_uuid() is unaffected (it's a pg_catalog built-in in
--     PG 13+, on the implicit search_path).
--
-- CREATE OR REPLACE preserves existing GRANTs, but we re-apply them
-- below for idempotency.
--
-- BYTE-FOR-BYTE PARITY WITH 0003: every line of the function body below
-- matches 20260519170003_functions.sql except for the `extensions.`
-- qualifier on the digest() call. Future diffs against this file
-- should reveal exactly that one change.

CREATE OR REPLACE FUNCTION public.validate_invitation_token(p_token TEXT)
RETURNS TABLE (
  id                       UUID,
  language                 TEXT,
  nationality              nationality_type,
  category                 category_type,
  questionnaire_version_id UUID,
  expires_at               TIMESTAMPTZ,
  response_id              UUID  -- NULL on fresh claim, set on resumption
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash TEXT;
  v_inv  invitations%ROWTYPE;
  v_resp responses%ROWTYPE;
BEGIN
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Lock the invitation row to serialize concurrent claims.
  SELECT * INTO v_inv
    FROM invitations
   WHERE token_hash = v_hash
     AND expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- token invalid or expired
  END IF;

  -- Resumption: existing non-submitted response.
  SELECT * INTO v_resp
    FROM responses
   WHERE invitation_id = v_inv.id
     AND submitted_at IS NULL
   ORDER BY started_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_inv.id,
      v_inv.preferred_language,
      v_inv.nationality,
      v_inv.category,
      v_inv.questionnaire_version_id,
      v_inv.expires_at,
      v_resp.id;
    RETURN;
  END IF;

  -- Already submitted: no re-entry.
  IF EXISTS (
    SELECT 1 FROM responses
     WHERE invitation_id = v_inv.id
       AND submitted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Fresh claim: serialized by the FOR UPDATE lock above.
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;  -- exhausted (e.g., shareable link past its max)
  END IF;

  UPDATE invitations
     SET use_count = use_count + 1,
         opened_at = COALESCE(opened_at, NOW()),
         status    = CASE
                       WHEN status = 'sent' THEN 'opened'::invitation_status
                       ELSE status
                     END
   WHERE id = v_inv.id;

  RETURN QUERY SELECT
    v_inv.id,
    v_inv.preferred_language,
    v_inv.nationality,
    v_inv.category,
    v_inv.questionnaire_version_id,
    v_inv.expires_at,
    NULL::UUID;  -- response not yet created; route handler does that next
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_invitation_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation_token(TEXT)
  TO anon, authenticated;
