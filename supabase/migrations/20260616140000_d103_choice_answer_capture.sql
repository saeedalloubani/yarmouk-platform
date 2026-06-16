-- 20260616140000_d103_choice_answer_capture.sql
--
-- D103 — answer storage for single/multi_choice questions.
--
-- D102 added the choice SCHEMA (answer_type + question_options) and authoring.
-- D103 makes choice questions answerable: this migration adds the storage +
-- the atomic write RPC; the application layer (respondent rendering + save +
-- submit-gate) lands against the regenerated types after this is applied.
--
-- Design (locked):
--   answer_options JUNCTION (one row per selected option) — ruled over an
--   array column: a real FK to question_options(id) gives referential
--   integrity an array can't, and D104 distributions count by option via a
--   plain GROUP BY. A choice answer is still ONE answers row (preserving
--   UNIQUE(response_id, question_id), which the whole read layer depends on);
--   its selections hang off answer_id. answer_text stays '' for a choice
--   answer (word_count GENERATED → 0, which is correct: a choice answer has no
--   answer-prose). The optional "why" comment lands in a DEDICATED
--   answer_comment column — NOT answer_text — so answer_text remains
--   canonically "the free-text answer" and word_count remains its prose count,
--   keeping long-format / ATLAS / demographics coherent.
--
-- Stable reference: respondents only ever answer an ACTIVE version, whose
-- question_options are immutable (tg_question_options_draft_only). So an
-- answer_options.option_id reference is permanently stable, and option_id
-- RESTRICT makes a dangling answer→option reference structurally impossible.
--
-- TYPED CHANGES → regenerate database.types.ts after this applies (new
-- answer_options table, answers.answer_comment column, save_choice_answer
-- function). Saeed runs `supabase gen types`; dev does not push.

-- ---------------------------------------------------------------------------
-- 1. answers.answer_comment — the optional "why" on a choice answer
-- ---------------------------------------------------------------------------
--   Nullable, no default: a free_text answer leaves it NULL (its path is
--   untouched); a choice answer with no comment leaves it NULL; a choice
--   answer with a comment stores the prose here. answer_text is unchanged
--   (NOT NULL DEFAULT '') — a choice answer's answer_text is ''.
ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS answer_comment TEXT;

-- ---------------------------------------------------------------------------
-- 2. answer_options — one row per selected option of a choice answer
-- ---------------------------------------------------------------------------
--   answer_id  ON DELETE CASCADE: deleting an answer drops its selections.
--   option_id  RESTRICT (no ON DELETE): an answered option cannot be deleted —
--              dangling answer→option references become impossible. (Moot in
--              practice: options are frozen once their version leaves draft,
--              and answers only exist on active versions.)
--   PK(answer_id, option_id): one row per (answer, option); also the dedup key.
--   option_id index: D104 "count by option" distributions (GROUP BY option_id).
CREATE TABLE answer_options (
  answer_id  UUID NOT NULL REFERENCES answers(id)          ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES question_options(id),
  PRIMARY KEY (answer_id, option_id)
);

CREATE INDEX answer_options_option_id_idx ON answer_options (option_id);

-- RLS mirrors answers/responses: owner+readonly may SELECT (response detail,
-- D104 distributions, exports — all via the authenticated admin client). There
-- are NO write policies: answer_options is written only by save_choice_answer
-- (SECURITY DEFINER, runs as owner, bypasses RLS) and cleared by the
-- answer_id CASCADE; the respondent flow reads/writes via the service-role
-- client, which bypasses RLS. No anon policy, by design (matches answers).
ALTER TABLE answer_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY ao_admins_select ON answer_options
  FOR SELECT TO authenticated
  USING (current_admin_role() IN ('owner', 'readonly'));

-- ---------------------------------------------------------------------------
-- 3. save_choice_answer — atomic write of a choice selection (+ comment)
-- ---------------------------------------------------------------------------
--   Mirrors commit_consent_sign (D83): SECURITY DEFINER + pinned search_path +
--   service_role-only grant (answer writes go through the admin client per
--   D48, never anon). This function is the TRUST BOUNDARY — it re-derives and
--   re-validates everything server-side; callers pass IDs from the session
--   cookie, never client-controlled.
--
--   Validation (structural / tamper — completeness is the submit gate's job):
--     - response must be OPEN: not submitted, not locked, status='active'
--       (withdraw sets status but NOT is_locked, so the status check is
--       required, not redundant). Locked FOR UPDATE for the atomic replace.
--     - question must belong to the response's OWN version and be a choice
--       type (rejects off-version / free_text / tampered question ids).
--     - EVERY supplied option_id must belong to that question (rejects foreign
--       ids; the count match also rejects duplicates).
--     - single_choice carries at most one option. ZERO options is permitted
--       (a transient / cleared autosave); requiredness is enforced at submit.
--   Then: upsert the single answer row (answer_text '', comment in its column)
--   and atomically REPLACE its answer_options set. Returns the answer_id.
--   No audit row — answer saves are high-frequency autosaves (the free_text
--   path doesn't audit per-save either).
CREATE FUNCTION public.save_choice_answer(
  p_response_id  UUID,
  p_question_id  UUID,
  p_option_ids   UUID[],
  p_comment      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id   UUID;
  v_answer_type  answer_type;
  v_answer_id    UUID;
  v_opt_count    INT;
  v_sel_count    INT := COALESCE(array_length(p_option_ids, 1), 0);
BEGIN
  -- 1. Lock the response; reject if not open for answers.
  SELECT i.questionnaire_version_id
    INTO v_version_id
    FROM responses AS r
    JOIN invitations AS i ON i.id = r.invitation_id
   WHERE r.id = p_response_id
     AND r.submitted_at IS NULL
     AND r.is_locked = FALSE
     AND r.status = 'active'
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'response % is not open for answers', p_response_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. Question must be on the response's own version and be a choice type.
  SELECT q.answer_type
    INTO v_answer_type
    FROM questions AS q
   WHERE q.id = p_question_id
     AND q.version_id = v_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'question % is not on the response''s version', p_question_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_answer_type = 'free_text' THEN
    RAISE EXCEPTION 'question % is free_text; use the text-answer path', p_question_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 3. Tamper defense: every supplied option must belong to this question.
  --    The count match also rejects duplicate ids in p_option_ids.
  IF v_sel_count > 0 THEN
    SELECT count(*)
      INTO v_opt_count
      FROM question_options AS o
     WHERE o.id = ANY (p_option_ids)
       AND o.question_id = p_question_id;
    IF v_opt_count <> v_sel_count THEN
      RAISE EXCEPTION 'one or more options do not belong to question %', p_question_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 4. single_choice accepts at most one option (radio). Zero is allowed
  --    transiently; submit-time completeness enforces required/allow_skip.
  IF v_answer_type = 'single_choice' AND v_sel_count > 1 THEN
    RAISE EXCEPTION 'single_choice question % accepts at most one option', p_question_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 5. Upsert the single answer row. answer_text stays '' for a choice answer
  --    (word_count GENERATED → 0); the comment lands in its own column.
  INSERT INTO answers AS a (response_id, question_id, answer_text, answer_comment, updated_at)
  VALUES (p_response_id, p_question_id, '', p_comment, NOW())
  ON CONFLICT (response_id, question_id) DO UPDATE
     SET answer_comment = EXCLUDED.answer_comment,
         updated_at     = NOW()
  RETURNING a.id INTO v_answer_id;

  -- 6. Replace the selection set atomically (same transaction as the upsert).
  DELETE FROM answer_options WHERE answer_id = v_answer_id;
  IF v_sel_count > 0 THEN
    INSERT INTO answer_options (answer_id, option_id)
    SELECT v_answer_id, unnest(p_option_ids);
  END IF;

  RETURN v_answer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_choice_answer(UUID, UUID, UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_choice_answer(UUID, UUID, UUID[], TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.save_choice_answer(UUID, UUID, UUID[], TEXT) TO service_role;
