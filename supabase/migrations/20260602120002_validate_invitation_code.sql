-- 20260602120002_validate_invitation_code.sql
--
-- D66 — New RPC: validate_invitation_code(p_code TEXT). The /enter
-- rescue-path equivalent of validate_invitation_token. Additive only —
-- the original token RPC is untouched per the D66 brief constraint.
--
-- BEHAVIORAL MIRROR of validate_invitation_token (20260519170012_validate_
-- token_creates_response.sql) with two material differences:
--
--   1. LOOKUP — the token RPC uses an O(1) UNIQUE INDEX on token_hash;
--      this RPC brute-decrypt-scans the candidate set. encrypt_pii uses
--      a random IV so deterministic ciphertext lookup is impossible —
--      the only way to find a row by code value is to decrypt the
--      candidate set and compare. At pilot scale (≤30 active
--      invitations with codes) this is sub-millisecond per /enter
--      submission. Two-phase find-then-lock: phase 1 identifies the
--      candidate id via the decrypt scan, phase 2 takes FOR UPDATE and
--      re-checks expires_at > NOW() under lock (races caught here).
--
--   2. STAMPING — access_code_used_at is set to NOW() ONLY on the
--      fresh-claim branch (not on resumption). This mirrors the URL
--      semantic: fresh claim consumes the row's use_count budget once
--      and is single-use by virtue of `use_count >= max_uses` gating
--      future fresh-claim attempts; resumption is unlimited so the
--      recipient can re-enter the code from a different device / after
--      a cookie clear / etc. and pick up their in-progress response.
--
--      access_code_used_at is therefore a FORENSIC TIMESTAMP — "when
--      /enter first fresh-claimed this invitation" — not a behavior
--      gate. Brute-force resistance comes from the layered model:
--        (a) 1M-entropy of 6-digit codes
--        (b) 60-day expires_at TTL
--        (c) Audit-log durability for failed-attempt forensics
--        (d) Code consumption on first fresh-claim (max_uses=1 budget;
--            after fresh-claim, attempts hit resumption — which only
--            succeeds while the in-progress response remains non-
--            submitted; after submission, /enter returns empty via
--            the already-submitted branch).
--
--      An attacker landing a valid code by brute force WOULD reach the
--      same threat ceiling as an attacker landing the URL plaintext:
--      they could resume the in-progress response and read its
--      answers. This is symmetric with the URL's threat model and
--      explicitly accepted by D66 (DECISIONS.md).
--
-- RETURN SHAPE — byte-identical to validate_invitation_token's 8-column
-- TABLE. Maximizes /enter Server Action's compatibility with the same
-- setSession + setLang + redirect pattern /r/[token] uses.
--
-- CANDIDATE FILTER — only `access_code_encrypted IS NOT NULL` and
-- `expires_at > NOW()`. NOT `access_code_used_at IS NULL` — that would
-- block resumption via /enter after a fresh-claim, breaking the
-- legitimate "lost my cookie, re-typing my code" path.
--
-- SECURITY DEFINER — same as validate_invitation_token. The RPC writes
-- to invitations + responses (RLS would otherwise block anon). search_
-- path pinned to public, pg_temp.
--
-- INPUT VALIDATION — p_code is matched against `^\d{6}$` before any
-- lookup. Garbage input returns empty (same as a wrong code). No-
-- enumeration: caller can't distinguish "you typed garbage" from "the
-- code was wrong."
--
-- GRANT EXECUTE TO anon, authenticated — same as token RPC. Anonymous
-- callers via /enter use the anon role.
--
-- PII / LOGGING DISCIPLINE — the RPC NEVER logs p_code. RAISE NOTICE is
-- not used. Decrypted plaintext stays inside the row-scan loop and
-- falls out of scope when the function returns.
--
-- AUDIT — the RPC doesn't write audit rows itself (matches the token
-- RPC). The /enter Server Action writes the per-attempt warn-audit on
-- failure path (logFailedAccessCode helper). Success is not audited
-- (matches token success — anonymous participant claim is operational,
-- not security-actionable).

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
  -- minted code. The candidate filter does NOT exclude "used" rows —
  -- access_code_used_at is a forensic stamp, not a gate. Resumption via
  -- /enter after a prior fresh-claim must continue to work.
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
  -- Concurrent /enter attempt on the same code: serializes; loser sees
  -- whatever state the winner left.
  SELECT i.* INTO v_inv
    FROM invitations AS i
   WHERE i.id = v_candidate_id
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- raced expiry; or row state changed
  END IF;

  -- Resumption: existing non-submitted response. Return its id WITHOUT
  -- stamping access_code_used_at — resumption is unlimited, mirrors the
  -- URL's resumption semantic. The recipient can re-type the same code
  -- from a new device / after a cookie clear and continue.
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

  -- Already submitted: no re-entry. Mirror token RPC. Returning empty
  -- routes the caller to /invitation-invalid (no enumeration of "you
  -- already submitted" — same generic failure as a wrong code).
  IF EXISTS (
    SELECT 1 FROM responses AS r
     WHERE r.invitation_id = v_inv.id
       AND r.submitted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Use exhausted (e.g., a shareable link past max_uses, or a token-
  -- fresh-claim already happened and max_uses=1). With max_uses default
  -- 1, this gates "the URL already fresh-claimed this invitation; the
  -- code can't reclaim it" — but the resumption branch above already
  -- handled that case (response exists, non-submitted, returned).
  -- Reaching this point means the response went away after fresh-claim
  -- (e.g. expired-and-cleaned, which we don't currently do) or some
  -- other rare state. Empty return is the safe default.
  IF v_inv.use_count >= v_inv.max_uses THEN
    RETURN;
  END IF;

  -- Fresh claim — serialized by FOR UPDATE above. Mirror token RPC's
  -- claim block + add access_code_used_at = NOW() in the same UPDATE
  -- (forensic stamp: when /enter first fresh-claimed this invitation).
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

REVOKE EXECUTE ON FUNCTION public.validate_invitation_code(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_invitation_code(TEXT)
  TO anon, authenticated;
