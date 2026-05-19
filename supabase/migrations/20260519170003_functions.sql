-- 20260519170003_functions.sql
-- Helper functions and the audit_log actor-snapshot trigger.
--
-- Why SECURITY DEFINER on the role/id helpers: read-only admins cannot
-- SELECT from `admins` (it is Owner-only — see 20260519170004). When an RLS policy
-- on (say) `responses` invokes current_admin_role(), the function must
-- still be able to read `admins` to resolve the caller's role. SECURITY
-- DEFINER runs the function as its owner (postgres role in Supabase),
-- bypassing the calling user's RLS. `search_path` is pinned so a
-- malicious schema-shadow can't reroute the lookup.
--
-- Why SECURITY DEFINER on validate_invitation_token: anonymous respondents
-- need to validate a token from the /r/[token] route handler without
-- granting `anon` blanket SELECT on `invitations`. Function reads + claims
-- a use atomically and returns a narrow projection (no PII to anon).

-- ---------- current_admin_role ----------

CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS admin_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
    FROM admins
   WHERE email = (auth.jwt() ->> 'email')
     AND status = 'active'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_role() TO authenticated;

-- ---------- current_admin_id ----------
-- Used by notifications + notification_preferences RLS so each admin
-- sees only their own rows.

CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
    FROM admins
   WHERE email = (auth.jwt() ->> 'email')
     AND status = 'active'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_admin_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_id() TO authenticated;

-- ---------- validate_invitation_token ----------
-- Resolves a plaintext token to a usable session, distinguishing
-- "validate" (idempotent, cheap, called on every /r/[token] hit) from
-- "claim a use" (mutation, exactly once per response).
--
-- Three exit paths:
--
--   1. RESUMPTION. There's already a non-submitted response for this
--      invitation. Returns the invitation projection + the existing
--      response_id. NO use_count change, NO status change. The route
--      handler should redirect the respondent to the in-progress
--      questionnaire keyed on that response_id. This is the path that
--      makes a 35–50 min questionnaire survive cookie clears, device
--      switches, and link re-clicks.
--
--   2. FRESH CLAIM. No existing response. Atomically increment use_count
--      (under the row lock taken at the top), set opened_at if NULL,
--      transition status 'sent' → 'opened'. Returns the projection
--      with response_id = NULL — the route handler creates the
--      response row next.
--
--   3. REJECT (empty result set). Token doesn't match, token expired,
--      a submitted response already exists for this invitation, or
--      uses are exhausted (use_count >= max_uses) with no in-progress
--      response. Caller should redirect to /invitation-invalid.
--
-- Atomicity: SELECT ... FOR UPDATE locks the invitation row at the top.
-- Two parallel /r/[token] hits on a single-use link serialize there;
-- the second hit then either finds the response the first one created
-- (resumption) or, if the first hit was in flight and hadn't committed
-- yet, sees a fully-claimed use_count and gets rejected.
--
-- Narrow projection: returns (id, language, nationality, category,
-- questionnaire_version_id, expires_at, response_id). No PII —
-- name/email ciphertext is not in this set because anon callers
-- receive this row via .rpc().

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
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

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

-- ---------- audit_log: actor-snapshot trigger ----------
-- UNCONDITIONALLY overwrites ts and all three actor fields on INSERT.
-- Application code cannot impersonate another admin by passing
-- actor_admin_id / actor_name / actor_role — the trigger discards
-- whatever was sent and resolves identity from the session JWT.
--
-- Sentinel values:
--   * No JWT (service_role connection: migrations, cron jobs, background
--     workers) → actor_name = 'system', actor_admin_id = NULL,
--     actor_role = NULL.
--   * JWT present but no matching active admin (removed admin, pending
--     activation, failed-login attempt, stale session) → actor_name =
--     'unknown', actor_admin_id = NULL, actor_role = NULL. Application
--     code should record the attempted email or other context in
--     metadata (the trigger never touches metadata).
--
-- Backfills with explicit actor identity must NOT use a normal INSERT
-- path. To backfill historical events with a specific actor, use a
-- service-role migration script that drops/disables this trigger for
-- the duration of the load.

CREATE OR REPLACE FUNCTION public.tg_audit_log_fill_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_admin admins%ROWTYPE;
BEGIN
  -- Unconditional: caller cannot backdate.
  NEW.ts := NOW();

  v_email := auth.jwt() ->> 'email';

  IF v_email IS NULL THEN
    -- service_role / system call — no user JWT in the session.
    NEW.actor_admin_id := NULL;
    NEW.actor_name     := 'system';
    NEW.actor_role     := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_admin
    FROM admins
   WHERE email = v_email
     AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    -- Unconditional overwrite: caller cannot impersonate.
    NEW.actor_admin_id := v_admin.id;
    NEW.actor_name     := v_admin.name;
    NEW.actor_role     := v_admin.role;
  ELSE
    -- JWT email present but doesn't resolve to an active admin.
    -- Recorded as 'unknown'; caller can put attempted_email or other
    -- forensic context in metadata.
    NEW.actor_admin_id := NULL;
    NEW.actor_name     := 'unknown';
    NEW.actor_role     := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_log_fill_actor
  BEFORE INSERT ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_audit_log_fill_actor();
