-- 20260519170009_alias_validate_token_columns.sql
--
-- Fixes column-vs-OUT-parameter ambiguity in validate_invitation_token.
--
-- The function declares `RETURNS TABLE (id UUID, language TEXT,
-- nationality nationality_type, category category_type,
-- questionnaire_version_id UUID, expires_at TIMESTAMPTZ, response_id UUID)`.
-- PL/pgSQL turns each TABLE column name into an implicit OUT parameter
-- visible inside the function body. Several of those names (id,
-- expires_at, category, etc.) are also real columns on `invitations`
-- or `responses` — so bare references inside the body are ambiguous.
-- Postgres trips at execution (lazy compile — CREATE FUNCTION succeeded
-- the previous two times).
--
-- Fix per D39: alias every table reference and qualify every column
-- reference inside the body.
--
--   - invitations AS i, responses AS r
--   - i.token_hash, i.expires_at, r.invitation_id, etc.
--   - RETURN QUERY SELECT continues to source from v_inv.* / v_resp.*
--     (record-field access on the ROWTYPE variables), which is
--     unambiguous regardless of the OUT-parameter shadowing.
--
-- Audit grep before applying (D39, second check):
--   grep -nE 'RETURNS TABLE' supabase/migrations/*.sql
--   then verify every SELECT/UPDATE/RETURNING inside each such
--   function body uses table aliases.

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
  SELECT i.* INTO v_inv
    FROM invitations AS i
   WHERE i.token_hash = v_hash
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- token invalid or expired
  END IF;

  -- Resumption: existing non-submitted response.
  SELECT r.* INTO v_resp
    FROM responses AS r
   WHERE r.invitation_id = v_inv.id
     AND r.submitted_at IS NULL
   ORDER BY r.started_at DESC
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
    SELECT 1 FROM responses AS r
     WHERE r.invitation_id = v_inv.id
       AND r.submitted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Fresh claim: serialized by the FOR UPDATE lock above.
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;  -- exhausted (e.g., shareable link past its max)
  END IF;

  UPDATE invitations AS i
     SET use_count = i.use_count + 1,
         opened_at = COALESCE(i.opened_at, NOW()),
         status    = CASE
                       WHEN i.status = 'sent' THEN 'opened'::invitation_status
                       ELSE i.status
                     END
   WHERE i.id = v_inv.id;

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
