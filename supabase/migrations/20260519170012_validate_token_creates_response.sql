-- 20260519170012_validate_token_creates_response.sql
--
-- Extends validate_invitation_token to atomically create the response
-- row on a fresh claim, and to return ref_code for the landing page.
--
-- Before this migration: the function returned response_id only on
-- resumption, expecting the caller to INSERT the response on fresh
-- claims. That couldn't work from /r/[token], because responses RLS
-- only permits owner inserts and the route handler runs anonymous.
--
-- Per D42: response row is created inside the SECURITY DEFINER
-- function, in the same transaction as the use_count increment and
-- status transition. No "validate succeeded but insert failed" race.
--
-- Per D38: extensions. qualifier on digest.
-- Per D39: every table aliased, every column qualified; body uses
--          v_inv.* / v_resp.* record-field access instead of bare
--          identifiers that would shadow against RETURNS TABLE
--          OUT-parameter names (id, expires_at, response_id, ref_code).
-- Per D44: token plaintext format (32 bytes b64url) is enforced at
--          mint-time, not in this function — we hash whatever arrives.
--
-- Smoke tests for this migration: three scenarios (A: fresh claim
-- creates response, B: resumption returns same response_id, C:
-- already-submitted returns empty). Each wraps in BEGIN/ROLLBACK so
-- nothing persists. Provided in the Session 2b-2 chat transcript for
-- paste-into-Studio after `supabase db push`.

CREATE OR REPLACE FUNCTION public.validate_invitation_token(p_token TEXT)
RETURNS TABLE (
  id                       UUID,
  language                 TEXT,
  nationality              nationality_type,
  category                 category_type,
  questionnaire_version_id UUID,
  expires_at               TIMESTAMPTZ,
  response_id              UUID,
  ref_code                 TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash    TEXT;
  v_inv     invitations%ROWTYPE;
  v_resp    responses%ROWTYPE;
  v_new_id  UUID;
BEGIN
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Lock the invitation row to serialize concurrent claims.
  SELECT i.* INTO v_inv
    FROM invitations AS i
   WHERE i.token_hash = v_hash
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- invalid or expired
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
      v_resp.id,
      v_inv.ref_code;
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

  -- Use exhausted (e.g., shareable link past max_uses).
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;
  END IF;

  -- Fresh claim — serialized by FOR UPDATE above.
  UPDATE invitations AS i
     SET use_count = i.use_count + 1,
         opened_at = COALESCE(i.opened_at, NOW()),
         status    = CASE
                       WHEN i.status = 'sent' THEN 'opened'::invitation_status
                       ELSE i.status
                     END
   WHERE i.id = v_inv.id;

  -- Eager response creation, atomic with the claim. Per D42.
  -- Per D39 discipline: alias the target table and use the alias in
  -- RETURNING to avoid any chance of shadowing against the OUT
  -- parameter named `id`.
  INSERT INTO responses AS r (invitation_id, language, started_at, is_locked)
       VALUES (v_inv.id, v_inv.preferred_language, NOW(), FALSE)
    RETURNING r.id INTO v_new_id;

  RETURN QUERY SELECT
    v_inv.id,
    v_inv.preferred_language,
    v_inv.nationality,
    v_inv.category,
    v_inv.questionnaire_version_id,
    v_inv.expires_at,
    v_new_id,
    v_inv.ref_code;
END;
$$;

-- Grants unchanged from 0009; re-stated for completeness.
REVOKE EXECUTE ON FUNCTION public.validate_invitation_token(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_invitation_token(TEXT)
  TO anon, authenticated;
