-- 20260616120000_d102_choice_questions_schema.sql
--
-- D102 — choice-question schema (single/multi-select, bilingual options).
--
-- Pilot feedback asked for closed-form questions (yes/no/maybe and the like),
-- not just free text. This migration adds the SCHEMA + freeze coverage only.
-- Authoring (the editor UI) is the application half of D102; respondent
-- rendering + answer capture is D103; dashboard distributions are D104. This
-- file ships ZERO answer storage — the answer_options junction lands in D103
-- (no point in an unused table now).
--
-- Design (locked with Sura):
--   answer_type = free_text | single_choice (radio) | multi_choice (checkbox).
--   yes/no/maybe is just single_choice with 3 authored options — NO special
--   yes/no type. Options are bilingual (label_en + label_ar), ordered, per
--   question, with a stable option_code (D103 answers reference the code/id,
--   never the display label, so rewording a label cannot corrupt history).
--   Options live in their OWN table (not JSON): D104 distributions count by
--   option, and bilingual+ordered is painful in JSON.
--
-- Two per-question flags ride along on `questions`:
--   allow_comment — show an optional "why" free-text box to the respondent.
--   allow_skip    — permit a no-answer even when is_required (an explicit
--                   "prefer not to answer" escape, distinct from is_required).
-- Both default FALSE; both kept type-agnostic (no CHECK tying them to choice
-- types) — author-time validation governs sensible use, not the DB.
--
-- ADDITIVE + non-rewriting. answer_type lands NOT NULL DEFAULT 'free_text', so
-- every existing question (all currently free-text) backfills to 'free_text'
-- with zero row rewrites and no meaning change. allow_comment / allow_skip
-- backfill to FALSE likewise.
--
-- FREEZE HOLE FIXED HERE (the load-bearing part). tg_questions_draft_only
-- (migration 0017) freezes the `questions` table once its version leaves
-- draft — but it fires ONLY on `questions`. A brand-new child table is NOT
-- covered: without a guard, an owner could edit an ACTIVE version's options
-- via direct PostgREST and silently corrupt collected answers (exactly the
-- D10 invariant 0017 exists to protect). So question_options gets its own
-- tg_question_options_draft_only — same shape as 0017, one extra join hop
-- (option → question → version.status). Both triggers together keep the whole
-- instrument (questions AND their options) frozen post-draft.
--
-- TYPED-COLUMN CHANGES → database.types.ts MUST be regenerated after this
-- applies (new answer_type enum, 3 new questions columns, the question_options
-- table). Saeed runs `supabase gen types` post-push; dev does not push.

-- ---------------------------------------------------------------------------
-- 1. answer_type enum
-- ---------------------------------------------------------------------------
CREATE TYPE answer_type AS ENUM ('free_text', 'single_choice', 'multi_choice');

-- ---------------------------------------------------------------------------
-- 2. questions: answer_type + the two per-question flags (all additive)
-- ---------------------------------------------------------------------------
ALTER TABLE questions
  ADD COLUMN answer_type   answer_type NOT NULL DEFAULT 'free_text',
  ADD COLUMN allow_comment BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN allow_skip    BOOLEAN     NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 3. question_options — bilingual, ordered, per-question, stable code
-- ---------------------------------------------------------------------------
--   ON DELETE CASCADE mirrors questions→questionnaire_versions: deleting a
--   draft question takes its options with it (the D102 authoring
--   compensating-delete relies on this). option_code is the stable handle
--   D103 answers will reference. Two UNIQUE keys: codes are unique within a
--   question (stable references can't collide), and order_index is unique
--   within a question (a deterministic display order, no ties).
CREATE TABLE question_options (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index  INT  NOT NULL,
  label_en     TEXT NOT NULL,
  label_ar     TEXT NOT NULL,
  option_code  TEXT NOT NULL,
  UNIQUE (question_id, option_code),
  UNIQUE (question_id, order_index)
);

-- Lookup options for a question in display order (read by the editor now;
-- by respondent render + export/analytics in D103/D104).
CREATE INDEX question_options_question_order_idx
  ON question_options (question_id, order_index);

-- ---------------------------------------------------------------------------
-- 4. Freeze coverage — extend D10 to question_options (the freeze-hole fix)
-- ---------------------------------------------------------------------------
--   Same shape as tg_questions_draft_only (migration 0017): SECURITY DEFINER +
--   locked search_path so it reads the parent status regardless of caller RLS
--   and can't be schema-shadow rerouted; ERRCODE check_violation for a clean
--   typed app error; COALESCE(NEW, OLD) so one function covers I/U/D. The only
--   difference is one extra hop: an option row knows its question_id, so we
--   join through questions to reach questionnaire_versions.status.
CREATE FUNCTION public.tg_question_options_draft_only()
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
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'question options are editable only on draft versions (parent version is %)',
      v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER question_options_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON question_options
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_question_options_draft_only();

-- ---------------------------------------------------------------------------
-- 5. RLS on question_options — mirrors the `questions` policies exactly
-- ---------------------------------------------------------------------------
--   Owner+readonly may SELECT (readonly supervisors need to see options for
--   D104 distributions); owner-only INSERT/UPDATE/DELETE (authoring). The
--   respondent flow reads via the service-role client, which bypasses RLS, so
--   no public-read policy is needed. The draft-only trigger above is the
--   freeze backstop independent of RLS.
ALTER TABLE question_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY qopt_admins_select ON question_options
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

CREATE POLICY qopt_owner_insert ON question_options
  FOR INSERT TO authenticated
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY qopt_owner_update ON question_options
  FOR UPDATE TO authenticated
  USING (current_admin_role() = 'owner')
  WITH CHECK (current_admin_role() = 'owner');

CREATE POLICY qopt_owner_delete ON question_options
  FOR DELETE TO authenticated
  USING (current_admin_role() = 'owner');
