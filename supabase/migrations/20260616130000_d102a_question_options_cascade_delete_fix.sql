-- 20260616130000_d102a_question_options_cascade_delete_fix.sql
--
-- D102a — fix: a choice question could never be DELETED on a draft.
--
-- The D102 freeze trigger tg_question_options_draft_only (migration
-- 20260616120000) fired fail-closed during the FK cascade of a question
-- delete. Deleting a question runs `DELETE FROM questions`; question_options
-- has `question_id ... ON DELETE CASCADE`, which Postgres implements as an
-- AFTER-delete RI trigger that issues `DELETE FROM ONLY question_options
-- WHERE question_id = $1` *after* the parent row is gone. That child delete
-- fires this BEFORE-DELETE trigger, whose lookup
--   SELECT qv.status FROM questions q JOIN questionnaire_versions qv ... WHERE q.id = OLD.question_id
-- finds NO parent row (already deleted in the same statement) → v_status NULL
-- → `NULL IS DISTINCT FROM 'draft'` is TRUE → RAISE check_violation → the whole
-- DELETE rolls back. Net effect: free_text questions delete fine (no options
-- to cascade), but single/multi_choice questions could never be deleted.
--
-- Confirmed on the live DB (rollback-safe reproduction):
--   ERROR: 23514: question options are editable only on draft versions (parent version is <NULL>)
--   CONTEXT: PL/pgSQL function tg_question_options_draft_only() line 10 at RAISE
--   SQL statement: "DELETE FROM ONLY public.question_options WHERE $1 = question_id"
--
-- FIX: fail-OPEN for exactly the legitimate cascade case. On DELETE, a missing
-- parent question (v_status NULL — version_status is NOT NULL, so NULL can only
-- mean the question row no longer exists) means the question itself is being
-- deleted in the same statement. Question deletes are ALREADY guarded to
-- drafts-only by tg_questions_draft_only, so an option cascade can never
-- originate from an active/closed version — permitting a parent-less option
-- DELETE cannot open the freeze hole. Every other path is unchanged: a direct
-- option INSERT/UPDATE/DELETE on a non-draft version still has its question
-- PRESENT (v_status = 'active'/'closed') and is still rejected.
--
-- Function body only (CREATE OR REPLACE) — the existing BEFORE INSERT OR UPDATE
-- OR DELETE trigger binding is untouched. No table/column/type change → no
-- database.types.ts regeneration needed (a regen would be a no-op).
--
-- NOTE (not fixed here): tg_questions_draft_only (migration 0017) has the same
-- structural pattern for a questionnaire_version delete cascading to its
-- questions. There is no UI path that deletes versions, so it is out of scope
-- for this fix — flagged for a separate decision if version-delete is ever
-- surfaced.

CREATE OR REPLACE FUNCTION public.tg_question_options_draft_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status version_status;
BEGIN
  SELECT qv.status INTO v_status
    FROM questions q
    JOIN questionnaire_versions qv ON qv.id = q.version_id
   WHERE q.id = COALESCE(NEW.question_id, OLD.question_id);

  -- Legitimate cascade from a (drafts-only-guarded) question delete: the
  -- parent question is already gone, so v_status is NULL. Permit it. This does
  -- NOT weaken the freeze — an option write on a non-draft version whose
  -- question is still present falls through to the check below and is rejected.
  IF TG_OP = 'DELETE' AND v_status IS NULL THEN
    RETURN OLD;
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'question options are editable only on draft versions (parent version is %)',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
