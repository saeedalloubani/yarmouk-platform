-- 20260519170017_questions_draft_only.sql
--
-- D10 freeze, enforced STRUCTURALLY (Session 3 — question editor).
--
-- D10 ("once a response exists, question wording is frozen") was
-- convention-only at the DB: nothing stopped an owner — the only role with
-- write on `questions` (RLS q_owner_*) — from editing an ACTIVE version's
-- questions via direct PostgREST, silently corrupting the analysis (an
-- edited-after-answer question invalidates the responses already given).
-- Same shape as the researcher_notes leak (migration 016): a load-bearing
-- invariant left to app good-behavior. This makes it structural.
--
-- The rule: questions are mutable ONLY while their parent version is
-- 'draft'. The question editor builds/edits drafts; activation and the
-- V2-draft-then-publish workflow (later sessions) only ever mutate DRAFT
-- questions, then flip the version's status — they never edit an active
-- version's questions — so this trigger is forward-compatible with them.
--
-- SECURITY DEFINER + locked search_path: the trigger must read
-- questionnaire_versions to learn the parent status regardless of the
-- caller's RLS; pinning search_path blocks a schema-shadow reroute (same
-- rationale as the other SECURITY DEFINER helpers). ERRCODE check_violation
-- (23514) so the app surfaces a clean, typed error rather than a generic
-- failure. COALESCE(NEW, OLD) so one function covers INSERT/UPDATE/DELETE.
--
-- CONFIRMED-INTENDED CONSEQUENCE: this also freezes the active
-- pilot_officials 18 questions (seed 0011). That is the point — post-
-- response wording changes go through a new V2 draft, never a direct edit.
--
-- Side note: after this, seed 0011 is no longer re-runnable (it inserts
-- into the active pilot_officials version). Harmless — migrations are
-- forward-only and it already applied. No typed column changes → no
-- database.types.ts regen (trigger + function only).

CREATE FUNCTION public.tg_questions_draft_only()
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
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'questions are editable only on draft versions (parent version is %)',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER questions_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON questions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_questions_draft_only();
