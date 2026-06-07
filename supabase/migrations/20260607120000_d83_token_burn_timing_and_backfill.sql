-- 20260607120000_d83_token_burn_timing_and_backfill.sql
--
-- D83 — Token burn timing fix + backfill 2 stuck participants.
--
-- ─── THE BUG (D81 forensic surface) ──────────────────────────────────
--
-- `invitations.use_count` was being incremented inside the two
-- validation RPCs (`validate_invitation_token` for the URL path,
-- `validate_invitation_code` for the /enter access-code path) on the
-- FRESH-CLAIM branch — i.e., the very first arrival from an email
-- link. That collapsed two semantically distinct events into one
-- counter:
--
--   * ARRIVAL  — participant opened the link, response row created,
--                invitation.status = 'opened'. No commitment yet.
--   * COMMIT   — participant signed consent_records (signed_at + the
--                six required boolean/text fields). This is the
--                actual ethics-traceable commitment.
--
-- The column name `use_count` and the CHECK(use_count <= max_uses)
-- constraint frame the counter as a "commitment counter" (a single-use
-- invitation should be burnable once, not twice). Pre-D83 the counter
-- was actually an "arrival counter" — burned on first /r/[token] or
-- /enter, not on consent.sign. Participants who explored the consent
-- page and walked away (RES-JOR-01 since June 3, NGO-02 since June 4)
-- left use_count = 1 even though they never committed. The pilot
-- analytics surface and the manual-reminder write path both read
-- use_count as a commitment proxy; the mismatch produced misleading
-- "this person used their link" framing.
--
-- (Mechanically, the stuck pair is still recoverable via the URL —
-- validate_invitation_token's RESUMPTION gate fires before the
-- use-exhausted gate, so a re-click hits resumption and returns the
-- existing response_id. They aren't permanently blocked. But the
-- counter is dishonest — which is the surfaced symptom.)
--
-- ─── THE FIX (3 parts in this single migration) ──────────────────────
--
-- (1) Drop the `use_count = use_count + 1` UPDATE column from BOTH
--     validate_* RPCs' fresh-claim UPDATE blocks. Preserve everything
--     else on the same UPDATE: opened_at + status sent→opened
--     transition + (for the code RPC) `access_code_used_at = NOW()`
--     forensic stamp (D66). The response row INSERT also stays — the
--     fresh-claim is still where the response is created (D42).
--
-- (2) New SECURITY DEFINER RPC `commit_consent_sign(...)`. In ONE
--     transaction:
--       a. INSERT consent_records ON CONFLICT (response_id) DO NOTHING
--          RETURNING id  → captures the new consent row's id, or NULL
--          if a concurrent double-submit already wrote one.
--       b. If RETURNING returned a row: UPDATE invitations
--          SET use_count = use_count + 1 WHERE id = (the joined
--          invitation_id). This is the moved burn.
--       c. If RETURNING returned a row: INSERT audit_log row
--          (action='invitation.consent_signed', severity='info',
--          metadata={invitationId, refCode, language, audioConsent}).
--          Direct INSERT (the public `log_audit()` RPC is
--          authenticated-only per D26 grants; this respondent-driven
--          flow has no admin JWT). The audit_log_fill_actor BEFORE
--          INSERT trigger sets actor_name='system' on no-JWT calls,
--          which is the correct semantic for participant events.
--     Returns the new consent_records.id, or NULL if already-consented.
--     The lib/actions/consent.ts caller treats both terminal outcomes
--     as success (redirects to /questionnaire either way).
--
-- (3) Backfill: UPDATE invitations SET use_count = 0 for the 2 rows
--     currently in the "pre-burned + no commit" state. Predicate
--     scoped to:
--       - non-terminal status (NOT submitted, NOT revoked)
--       - no submission (submitted_at IS NULL)
--       - pre-burned (use_count >= 1)
--       - still time-valid (expires_at > NOW())  ← D83 read-first E3
--       - no consent_records exists for any of this invitation's
--         responses
--     Expected blast radius at deploy time: exactly 2 rows
--     (RES-JOR-01, NGO-02). The pre-flight SELECT below verifies
--     this BEFORE the UPDATE applies in production.
--
-- ─── PRE-FLIGHT VERIFICATION ─────────────────────────────────────────
--
-- Run this in Supabase Studio AFTER backup + BEFORE supabase db push:
--
--   SELECT id, ref_code, status, use_count, max_uses, expires_at
--     FROM invitations
--    WHERE status NOT IN ('submitted', 'revoked')
--      AND submitted_at IS NULL
--      AND use_count >= 1
--      AND expires_at > NOW()
--      AND NOT EXISTS (
--        SELECT 1
--          FROM responses r
--          JOIN consent_records c ON c.response_id = r.id
--         WHERE r.invitation_id = invitations.id
--      );
--
-- EXPECTED at deploy time: exactly 2 rows
-- (ref_code IN ('RES-JOR-01', 'NGO-02')). If the count differs:
-- HOLD the migration, re-brief, do not apply.
--
-- ─── REVERSIBILITY ───────────────────────────────────────────────────
--
-- The RPC body changes are forward-only by Supabase migration policy
-- (no rewriting prior migrations). To restore the pre-D83 burn-on-
-- validation semantic, write a NEW migration with the prior bodies
-- preserved at:
--   supabase/migrations/20260519170012_validate_token_creates_response.sql
--   supabase/migrations/20260602120003_validate_invitation_code_no_resumption_stamp.sql
--
-- To unwind the backfill specifically (restore the 2 rows' use_count
-- to max_uses for the same predicate):
--
--   UPDATE invitations
--      SET use_count = max_uses
--    WHERE status NOT IN ('submitted', 'revoked')
--      AND submitted_at IS NULL
--      AND use_count = 0
--      AND expires_at > NOW()
--      AND NOT EXISTS (
--        SELECT 1
--          FROM responses r
--          JOIN consent_records c ON c.response_id = r.id
--         WHERE r.invitation_id = invitations.id
--      );
--
-- ─── REVIEW DISCIPLINE ───────────────────────────────────────────────
--
--   D38 — encrypt_pii / decrypt_pii / pgcrypto qualification: untouched
--         (validate_invitation_code still calls public.decrypt_pii).
--   D39 — every table aliased, every column qualified.
--   D42 — fresh claim atomicity: response row INSERT inside the same
--         SECURITY DEFINER body as the status/opened_at UPDATE.
--   D45 — RETURNS TABLE change requires DROP + CREATE. We DROP both
--         validate_* functions (same RETURNS shape; DROP is for grant
--         hygiene + body atomic-replacement).
--   D66 — access_code_used_at = NOW() PRESERVED on fresh claim of the
--         code RPC (forensic stamp, not a behavior gate).


-- ═══════════════════════════════════════════════════════════════════
-- SECTION (a) — Redefine validate_invitation_token
-- ═══════════════════════════════════════════════════════════════════
-- Drop use_count++ from fresh-claim UPDATE. Preserve every other
-- behavior: token-hash lookup, FOR UPDATE serialization, resumption
-- gate, already-submitted gate, use-exhausted defensive gate,
-- opened_at + status transition, response row INSERT, ref_code on
-- the return shape.

DROP FUNCTION IF EXISTS public.validate_invitation_token(TEXT);

CREATE FUNCTION public.validate_invitation_token(p_token TEXT)
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

  -- Resumption: existing non-submitted response. Non-burning path.
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

  -- Use exhausted (defense-in-depth). Effectively unreachable on the
  -- post-D83 typical flow: use_count only ever climbs inside
  -- commit_consent_sign, which is gated by an existing response (the
  -- resumption block above). Kept to preserve the prior contract.
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;
  END IF;

  -- Fresh claim — serialized by FOR UPDATE above.
  --
  -- D83 — `use_count = i.use_count + 1` REMOVED from this UPDATE.
  -- The burn moves to commit_consent_sign (consent.sign Server
  -- Action). opened_at + status sent→opened STAY: those are
  -- arrival evidence, not commitment evidence.
  UPDATE invitations AS i
     SET opened_at = COALESCE(i.opened_at, NOW()),
         status    = CASE
                       WHEN i.status = 'sent' THEN 'opened'::invitation_status
                       ELSE i.status
                     END
   WHERE i.id = v_inv.id;

  -- Eager response creation, atomic with arrival. Per D42.
  -- alias r + RETURNING r.id keeps the OUT-param `id` from shadowing.
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

-- DROP removed prior grants; restate per D45.
REVOKE EXECUTE ON FUNCTION public.validate_invitation_token(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_invitation_token(TEXT)
  TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION (b) — Redefine validate_invitation_code
-- ═══════════════════════════════════════════════════════════════════
-- Drop use_count++ from fresh-claim UPDATE. PRESERVE
-- `access_code_used_at = NOW()` (D66 forensic timestamp — distinct
-- from use_count semantics; records when /enter first fresh-claimed
-- this row). Everything else identical to the prior D66 body.

DROP FUNCTION IF EXISTS public.validate_invitation_code(TEXT);

CREATE FUNCTION public.validate_invitation_code(p_code TEXT)
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
  v_candidate_id UUID;
  v_inv          invitations%ROWTYPE;
  v_resp         responses%ROWTYPE;
  v_new_id       UUID;
BEGIN
  -- Format guard — same no-enumeration semantic as a wrong code.
  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN;
  END IF;

  -- Phase 1: brute-decrypt scan over code-bearing live set.
  -- Candidate filter unchanged from D66's revised body (3 conditions,
  -- no access_code_used_at gate — resumption via /enter must keep
  -- working after a prior fresh-claim).
  SELECT i.id INTO v_candidate_id
    FROM invitations AS i
   WHERE i.access_code_encrypted IS NOT NULL
     AND i.expires_at > NOW()
     AND public.decrypt_pii(i.access_code_encrypted) = p_code
   LIMIT 1;

  IF v_candidate_id IS NULL THEN
    RETURN;
  END IF;

  -- Phase 2: lock + re-check expiry under FOR UPDATE.
  SELECT i.* INTO v_inv
    FROM invitations AS i
   WHERE i.id = v_candidate_id
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Resumption: existing non-submitted response. Non-burning,
  -- unlimited (mirrors URL token semantic).
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

  -- Use exhausted (defense-in-depth, see token RPC comment).
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;
  END IF;

  -- Fresh claim.
  --
  -- D83 — `use_count = i.use_count + 1` REMOVED from this UPDATE.
  -- `access_code_used_at = NOW()` PRESERVED — that's the D66
  -- forensic timestamp for /enter, not a behavior gate, and it
  -- records something use_count doesn't (which entry path was
  -- used). The two fields are independent.
  UPDATE invitations AS i
     SET opened_at           = COALESCE(i.opened_at, NOW()),
         status              = CASE
                                 WHEN i.status = 'sent' THEN 'opened'::invitation_status
                                 ELSE i.status
                               END,
         access_code_used_at = NOW()
   WHERE i.id = v_inv.id;

  -- Eager response creation, atomic with arrival (D42 mirror).
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

REVOKE EXECUTE ON FUNCTION public.validate_invitation_code(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_invitation_code(TEXT)
  TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION (c) — New commit_consent_sign RPC
-- ═══════════════════════════════════════════════════════════════════
-- Atomic INSERT consent_records + UPDATE invitations.use_count + INSERT
-- audit_log row. ON CONFLICT (response_id) DO NOTHING handles double-
-- submit idempotency; the loser gets v_consent_id = NULL and exits
-- without burning the counter or writing an audit row.
--
-- Returns the new consent_records.id (UUID) on a fresh sign, or
-- NULL if a row was already present (already-consented). The caller
-- (lib/actions/consent.ts submitConsent) treats both outcomes as
-- success — redirects to /questionnaire either way.
--
-- service_role-only EXECUTE grant: this RPC is called from the
-- admin client in the public consent flow (D48). It is NOT a
-- participant-anon entry point — the route through is admin client
-- → SECURITY DEFINER body, mirroring how D48 already isolates the
-- public flow's writes.

CREATE FUNCTION public.commit_consent_sign(
  p_response_id            UUID,
  p_signed_name_encrypted  TEXT,
  p_audio_consent          BOOLEAN,
  p_agreed_to_read         BOOLEAN,
  p_agreed_to_participate  BOOLEAN,
  p_language               TEXT,
  p_consent_text_version   TEXT DEFAULT 'v1.0'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consent_id    UUID;
  v_invitation_id UUID;
  v_ref_code      TEXT;
BEGIN
  -- ATOMIC step 1 — INSERT consent_records, idempotent via
  -- ON CONFLICT (response_id is UNIQUE). The loser of a concurrent
  -- double-submit or a network retry gets v_consent_id NULL and
  -- short-circuits below without writing anything else.
  INSERT INTO consent_records AS c (
    response_id,
    signed_name_encrypted,
    audio_consent,
    agreed_to_read,
    agreed_to_participate,
    language,
    consent_text_version
  )
  VALUES (
    p_response_id,
    p_signed_name_encrypted,
    p_audio_consent,
    p_agreed_to_read,
    p_agreed_to_participate,
    p_language,
    p_consent_text_version
  )
  ON CONFLICT (response_id) DO NOTHING
  RETURNING c.id INTO v_consent_id;

  IF v_consent_id IS NULL THEN
    -- Already consented (concurrent double-submit or retry). Benign;
    -- caller redirects forward as if successful.
    RETURN NULL;
  END IF;

  -- ATOMIC step 2 — look up invitation_id + ref_code for the burn
  -- (UPDATE below) and the audit metadata (INSERT below). Joining on
  -- responses + invitations is safe inside SECURITY DEFINER; no PII
  -- columns are read.
  SELECT r.invitation_id, i.ref_code
    INTO v_invitation_id, v_ref_code
    FROM responses AS r
    JOIN invitations AS i ON i.id = r.invitation_id
   WHERE r.id = p_response_id;

  -- ATOMIC step 3 — burn use_count. CHECK(use_count <= max_uses) is
  -- satisfied: ON CONFLICT above ensures this fires at most once per
  -- response, and max_uses default 1 means use_count goes 0→1 exactly
  -- once per consenting participant.
  UPDATE invitations AS i
     SET use_count = i.use_count + 1
   WHERE i.id = v_invitation_id;

  -- ATOMIC step 4 — audit row. Direct INSERT (the public log_audit()
  -- RPC is authenticated-only per D26 grants; this respondent-driven
  -- flow has no admin JWT). The audit_log_fill_actor BEFORE INSERT
  -- trigger sets actor_name='system' on no-JWT calls — correct
  -- semantic for participant-initiated events.
  --
  -- Metadata strictly non-PII: invitationId (UUID), refCode (public
  -- identifier), language ('en'|'ar'), audioConsent (boolean). NO
  -- name, NO email, NO token plaintext.
  INSERT INTO audit_log (action, resource, severity, metadata)
  VALUES (
    'invitation.consent_signed',
    v_ref_code,
    'info',
    jsonb_build_object(
      'invitationId',  v_invitation_id,
      'refCode',       v_ref_code,
      'language',      p_language,
      'audioConsent',  p_audio_consent
    )
  );

  RETURN v_consent_id;
END;
$$;

-- service_role-only EXECUTE. Strip PUBLIC + the Supabase ALTER
-- DEFAULT PRIVILEGES grants to anon + authenticated (see D26 log_audit
-- comment) so this RPC is callable only from the admin client.
REVOKE EXECUTE ON FUNCTION public.commit_consent_sign(
  UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_consent_sign(
  UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.commit_consent_sign(
  UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION (e) — Backfill use_count for stuck rows
-- ═══════════════════════════════════════════════════════════════════
-- Reset use_count = 0 for invitations matching the "non-terminal +
-- pre-burned + no commit yet" predicate. After this UPDATE, the
-- counter honestly reflects the post-D83 semantic: "this participant
-- has not committed".
--
-- Pre-flight SELECT (run BEFORE supabase db push, expects 2 rows):
-- see comment block at the top of this file.

UPDATE invitations
   SET use_count = 0
 WHERE status NOT IN ('submitted', 'revoked')
   AND submitted_at IS NULL
   AND use_count >= 1
   AND expires_at > NOW()
   AND NOT EXISTS (
     SELECT 1
       FROM responses r
       JOIN consent_records c ON c.response_id = r.id
      WHERE r.invitation_id = invitations.id
   );
