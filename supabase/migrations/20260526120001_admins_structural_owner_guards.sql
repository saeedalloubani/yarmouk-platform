-- 20260526120001_admins_structural_owner_guards.sql
--
-- Structural escalation prevention for the admins table — self-service
-- prerequisite for the supervisor-invite UI. Two BEFORE triggers, each
-- guarding one invariant. Both rely on the auth.jwt()-IS-NOT-NULL
-- distinction to allow migration/seed-time inserts while blocking ALL
-- application-runtime escalation paths (owner UI, owner PostgREST direct,
-- service-role from the invite action's auth.admin.* calls).
--
-- The auth.jwt() distinction was EMPIRICALLY VERIFIED across three
-- contexts before this migration was finalized:
--   (a) supabase db query / migration runner (postgres role, no JWT)
--         → auth.jwt() IS NULL              → ALLOWED (seeds work)
--   (b) authenticated owner via PostgREST   → auth.jwt() = {role: authenticated, ...}
--                                           → BLOCKED
--   (c) service_role via PostgREST          → auth.jwt() = {role: service_role, ...}
--                                           → BLOCKED
--
-- An earlier candidate check — current_setting('request.jwt.claim.role',
-- true) IS NULL — was REJECTED: PostgREST no longer populates the per-
-- claim GUCs (only the full request.jwt.claims JSON), so that check
-- returns NULL for BOTH context (a) AND context (c). It would false-
-- negative service-role and let the action escalate. Do NOT swap.
--
-- SECURITY DEFINER + locked search_path: same rationale as the other
-- guard triggers (017 questions_draft_only, 20260524160001 versions_no_
-- unfreeze_with_responses) — read whatever the trigger needs (admins
-- count for Invariant 2) regardless of caller RLS; pin search_path
-- against schema-shadow reroutes.
--
-- ERRCODEs:
--   42501 (insufficient_privilege) for Invariant 1 — semantically right
--     for "the application layer is not allowed to do this"
--   23514 (check_violation) for Invariant 2 — matches the existing
--     unfreeze guard's idiom; the action layer maps to a typed error

-- ============================================================================
-- Invariant 1: no runtime owner-creation or owner-promotion.
-- Owners can only be minted by a migration (no JWT context). The
-- application — owner UI, service-role, anyone — cannot insert a row with
-- role='owner' or UPDATE a row to role='owner'.
-- ============================================================================

CREATE FUNCTION public.tg_admins_no_runtime_owner_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'owner' AND auth.jwt() IS NOT NULL THEN
    RAISE EXCEPTION
      'cannot create or promote to owner via application; owner provisioning is a migration-only path'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admins_no_runtime_owner_escalation
  BEFORE INSERT OR UPDATE ON admins
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_admins_no_runtime_owner_escalation();

-- ============================================================================
-- Invariant 2: never demote, remove, or delete the last active owner.
-- "Last" = count of OTHER rows where role='owner' AND status='active' is
-- zero. Triggers on UPDATE and DELETE — INSERT can't reduce the active-
-- owner count, so no need.
-- ============================================================================

CREATE FUNCTION public.tg_admins_protect_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_other_active_owners INT;
BEGIN
  -- Only relevant when this row IS currently an active owner. Any other
  -- transition (readonly→anything, removed→anything, etc.) is not the
  -- concern of this trigger.
  IF OLD.role = 'owner' AND OLD.status = 'active' THEN
    SELECT count(*) INTO v_other_active_owners
      FROM admins
     WHERE role = 'owner'
       AND status = 'active'
       AND id != OLD.id;

    IF v_other_active_owners = 0 THEN
      -- DELETE — never allowed on the last active owner.
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
          'cannot delete the last active owner (% / %)', OLD.email, OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      -- UPDATE — block only the transition out of (role=owner,status=active).
      -- Other updates on the row (e.g. renaming) stay legal.
      IF TG_OP = 'UPDATE' AND (NEW.role != 'owner' OR NEW.status != 'active') THEN
        RAISE EXCEPTION
          'cannot demote or deactivate the last active owner (% / %)', OLD.email, OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER admins_protect_last_owner
  BEFORE UPDATE OR DELETE ON admins
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_admins_protect_last_owner();
