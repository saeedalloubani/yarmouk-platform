-- 20260602120003_validate_invitation_code_no_resumption_stamp.sql
--
-- D66 FIX-FORWARD — revise validate_invitation_code to drop the
-- resumption stamping + the used-at gate, matching the URL semantic.
--
-- WHY THIS MIGRATION EXISTS (commit history vs prod state mismatch):
--
-- The previous migration (20260602120002_validate_invitation_code.sql)
-- was authored TWICE in this branch's history. The first revision —
-- strict single-use (stamping access_code_used_at on BOTH fresh-claim
-- AND resumption, with the candidate filter excluding stamped rows) —
-- was what got picked up by `supabase db push` and is what's deployed
-- in prod. The second revision (the file currently on disk in this
-- repo, with the revised semantic) was authored AFTER the push and
-- therefore never reached the deployed function body.
--
-- Forward-only discipline: don't rewrite history (don't amend 12002),
-- write a new migration that brings prod to the intended end state.
-- This file is that migration. It is idempotent: a fresh replay that
-- applied the disk version of 12002 first produces the same body
-- twice (DROP + CREATE is identical-body); a prod replay over the
-- strict deployment replaces the strict body with the revised body.
-- Either path converges to the revised function.
--
-- ─── THE THREE CHANGES FROM STRICT TO REVISED ────────────────────────
--
-- (1) Phase 1 candidate filter — REMOVED `AND i.access_code_used_at IS
--     NULL`. The candidate set is now `access_code_encrypted IS NOT
--     NULL AND expires_at > NOW()` only. Used codes stay scannable so
--     resumption via /enter continues to find the row after a prior
--     fresh-claim.
--
-- (2) Phase 2 lock re-check — REMOVED `AND i.access_code_used_at IS
--     NULL`. The re-check under FOR UPDATE now only re-validates
--     `expires_at > NOW()`. Concurrent /enter attempts still serialize
--     on the row lock; the loser sees whatever state the winner left,
--     but neither is blocked by the prior stamping.
--
-- (3) Resumption branch — REMOVED the `UPDATE invitations SET
--     access_code_used_at = NOW()` that fired before RETURN QUERY.
--     Resumption now returns the existing response_id WITHOUT
--     stamping. Strict single-use is dropped.
--
-- Fresh-claim still stamps access_code_used_at = NOW() (unchanged
-- from strict). The column is now a FORENSIC TIMESTAMP recording when
-- /enter first fresh-claimed this invitation — not a behavior gate
-- for resumption.
--
-- ─── REVISED SECURITY MODEL ───────────────────────────────────────────
--
-- Brute-force resistance is now layered:
--   (a) 1M entropy of 6-digit codes
--   (b) 60-day expires_at TTL
--   (c) Audit-log durability for failed-attempt forensics
--       (lib/audit.ts logFailedAccessCode, severity=warn)
--   (d) max_uses budget gate (use_count >= max_uses returns empty)
--
-- The stamping was previously a partial mitigation (made a burned code
-- non-replayable). Dropping it is intentional — the URL today is
-- reusable for resumption (the token plaintext doesn't burn after the
-- fresh-claim), and matching that semantic preserves the legitimate
-- recovery path: a participant who fresh-claimed via /enter and lost
-- their session cookie (cleared browser, different device, expired)
-- can re-type the same code and continue their in-progress response.
--
-- Resumption via /enter is UNLIMITED as long as `expires_at > NOW()`
-- AND no response has been submitted. Mirrors URL token semantics
-- exactly. An attacker landing a valid code by brute force reaches
-- the SAME threat ceiling as an attacker landing the URL plaintext:
-- both can resume the in-progress response. Symmetric, explicitly
-- accepted (D66).
--
-- ─── MIGRATION SHAPE ──────────────────────────────────────────────────
--
-- DROP FUNCTION IF EXISTS public.validate_invitation_code(TEXT)
--   - Idempotent: works whether the function exists (prod) or not
--     (fresh replay where this migration runs in isolation, or where
--     12002 hasn't been applied yet).
--   - DROP rather than CREATE OR REPLACE alone because we want a
--     clean cutover — no risk of inheriting a stale plan or grants.
--
-- CREATE FUNCTION (not CREATE OR REPLACE) — the DROP above guarantees
--   the function doesn't exist. Plain CREATE is more honest about
--   what's happening (full replacement, not amendment).
--
-- REVOKE + GRANT EXECUTE — DROP removed the prior grants, so we
--   restate them. Same shape as validate_invitation_token's grant
--   block (anon + authenticated).
--
-- ─── VERIFICATION (Saeed-driven, post-apply) ──────────────────────────
--
-- Run in Studio to confirm the revised body landed:
--
--   SELECT pg_get_functiondef('public.validate_invitation_code(text)'::regprocedure);
--
-- Expected differences vs the strict version:
--   - Phase 1 candidate filter has 3 WHERE conditions, not 4
--     (no `access_code_used_at IS NULL`).
--   - Phase 2 lock re-check has 2 WHERE conditions, not 3
--     (no `access_code_used_at IS NULL`).
--   - Resumption branch's `IF FOUND THEN` block contains NO
--     `UPDATE invitations` statement before RETURN QUERY.
--   - Fresh-claim branch's UPDATE still includes
--     `access_code_used_at = NOW()`.

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
  -- Format guard. No row can match a non-6-digit input, so short-circuit.
  -- Same empty-return semantic as a wrong code (no-enumeration).
  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN;
  END IF;

  -- Phase 1: identify the candidate row by brute-decrypt scan over the
  -- code-bearing live set. O(N) where N = unexpired invitations with a
  -- minted code. Candidate filter is 3 conditions only — NO
  -- `access_code_used_at IS NULL` gate (resumption via /enter must keep
  -- working after a fresh-claim).
  SELECT i.id INTO v_candidate_id
    FROM invitations AS i
   WHERE i.access_code_encrypted IS NOT NULL
     AND i.expires_at > NOW()
     AND public.decrypt_pii(i.access_code_encrypted) = p_code
   LIMIT 1;

  IF v_candidate_id IS NULL THEN
    RETURN;  -- no match — wrong code, expired, or pre-D66 row (no code)
  END IF;

  -- Phase 2: lock the candidate + re-check expiry under FOR UPDATE.
  -- Re-check is 2 conditions — NO `access_code_used_at IS NULL`.
  -- Concurrent /enter attempts serialize; loser sees whatever state the
  -- winner committed (but no longer gated by the prior stamping).
  SELECT i.* INTO v_inv
    FROM invitations AS i
   WHERE i.id = v_candidate_id
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- raced expiry; or row state changed
  END IF;

  -- Resumption: existing non-submitted response. Return its id WITHOUT
  -- any UPDATE. Resumption is UNLIMITED — mirrors URL token semantic.
  -- The recipient can re-type the same code from a new device / after a
  -- cookie clear and continue their in-progress response.
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

  -- Already submitted: no re-entry. Mirror token RPC. Empty return
  -- routes /enter to /invitation-invalid (no enumeration of "already
  -- submitted" — same generic failure as a wrong code).
  IF EXISTS (
    SELECT 1 FROM responses AS r
     WHERE r.invitation_id = v_inv.id
       AND r.submitted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Use exhausted (e.g., a shareable link past max_uses, or a token-
  -- fresh-claim already consumed the only slot when max_uses=1). With
  -- max_uses default 1, this gates "the URL already fresh-claimed this
  -- invitation; the code can't reclaim" — though the resumption branch
  -- above already handled the common case (response exists, non-
  -- submitted, returned). Reaching here means the response went away
  -- after fresh-claim (rare) or some other edge state. Empty return is
  -- the safe default.
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;
  END IF;

  -- Fresh claim — serialized by FOR UPDATE above. Mirror token RPC's
  -- claim block + stamp access_code_used_at = NOW() in the SAME UPDATE.
  -- The stamp is a forensic timestamp: "when /enter first fresh-claimed
  -- this invitation." NOT a gate — subsequent /enter calls on this same
  -- row hit the resumption branch above and return without stamping
  -- again.
  UPDATE invitations AS i
     SET use_count           = i.use_count + 1,
         opened_at           = COALESCE(i.opened_at, NOW()),
         status              = CASE
                                 WHEN i.status = 'sent' THEN 'opened'::invitation_status
                                 ELSE i.status
                               END,
         access_code_used_at = NOW()
   WHERE i.id = v_inv.id;

  -- Eager response creation, atomic with the claim (D42 mirror).
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

-- DROP removed the prior grants; restate them. Same shape as
-- validate_invitation_token (anon + authenticated).
REVOKE EXECUTE ON FUNCTION public.validate_invitation_code(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_invitation_code(TEXT)
  TO anon, authenticated;
