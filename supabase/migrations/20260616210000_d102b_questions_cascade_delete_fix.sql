-- 20260616210000_d102b_questions_cascade_delete_fix.sql
--
-- D102b — fix: a questionnaire VERSION could never be DELETED once it had
-- questions. The sibling of D102a, on tg_questions_draft_only this time.
--
-- tg_questions_draft_only (migration 0017) fires fail-closed during the FK
-- cascade of a VERSION delete. Deleting a questionnaire_versions row runs the
-- child ON DELETE CASCADE `DELETE FROM ONLY questions WHERE version_id = $1`
-- AFTER the parent version row is gone; that child delete fires this
-- BEFORE-DELETE trigger, whose lookup
--   SELECT status FROM questionnaire_versions WHERE id = OLD.version_id
-- finds NO row (already deleted in the same statement) → v_status NULL →
-- NULL IS DISTINCT FROM 'draft' is TRUE → RAISE check_violation → the whole
-- version delete rolls back.
--
-- Flagged at D102a as the known parallel pattern and parked on the assumption
-- "no UI/ops path deletes versions." That assumption is now false: the
-- choice-question live-test sandbox-cleanup path deletes a throwaway version
-- and hit this exactly:
--   ERROR: 23514: questions are editable only on draft versions (parent version is <NULL>)
--   CONTEXT: PL/pgSQL function tg_questions_draft_only() line 9 at RAISE
--   SQL statement: "DELETE FROM ONLY public.questions WHERE version_id = $1"
--
-- FIX — identical surgical pattern to D102a: fail-OPEN for exactly the
-- legitimate cascade case. On DELETE, a missing parent version (v_status NULL
-- — version_status is NOT NULL, so NULL can only mean the version row no
-- longer exists) means the version itself is being deleted in the same
-- statement. Permitting a parent-less question DELETE cannot open the freeze
-- hole: a direct question INSERT/UPDATE/DELETE on a live (active/closed)
-- version still has its version PRESENT (v_status = 'active'/'closed') and is
-- still rejected below.
--
-- Function body only (CREATE OR REPLACE) — the existing
-- BEFORE INSERT OR UPDATE OR DELETE trigger binding is untouched. No
-- table/column/type change → no database.types.ts regeneration.

CREATE OR REPLACE FUNCTION public.tg_questions_draft_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status version_status;
BEGIN
  SELECT status INTO v_status
    FROM questionnaire_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);

  -- D102b: a DELETE whose parent version is already gone (v_status NULL —
  -- version_status is NOT NULL, so NULL can only mean the version row no
  -- longer exists) is a CASCADE from a version delete. Permit it. This does
  -- NOT weaken the freeze — a question write on a live version still has its
  -- version present (v_status = 'active'/'closed') and is rejected below.
  IF TG_OP = 'DELETE' AND v_status IS NULL THEN
    RETURN OLD;
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'questions are editable only on draft versions (parent version is %)',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
