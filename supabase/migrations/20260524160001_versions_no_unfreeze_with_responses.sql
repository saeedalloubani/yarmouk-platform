-- 20260524160001_versions_no_unfreeze_with_responses.sql
--
-- Go-live hardening (safety-audit caveat 1). D10's questions_draft_only trigger
-- freezes question EDITS while a version is non-draft. But nothing stopped an
-- OWNER (RLS qv_owner_update) from demoting an ACTIVE version back to 'draft'
-- via direct PostgREST/SQL — which re-opens question edits on an instrument that
-- already has responses, silently corrupting collected data. No app path does
-- this today (the publish/V2 flow is unbuilt), so this makes the invariant
-- STRUCTURAL before real collection starts.
--
-- BLOCKS: any UPDATE moving a version INTO 'draft' from a non-draft state when
--   the version already has >=1 response. That is the ONLY unfreeze path —
--   questions_draft_only treats 'closed' as frozen too, so only -> 'draft'
--   re-enables edits.
-- ALLOWS (unchanged workflows):
--   - draft -> active  (publish / the imminent activation),
--   - active -> closed (normal end-of-collection — stays frozen),
--   - any -> draft while the version has ZERO responses (the officials-revision
--     workflow used during the pilot restructure),
--   - non-status edits on any version, and all draft editing.
--
-- Responses tie to a version through invitations
-- (responses.invitation_id -> invitations.questionnaire_version_id).
-- SECURITY DEFINER + locked search_path so it reads responses/invitations
-- regardless of caller RLS (same rationale as the other guard triggers);
-- ERRCODE check_violation for a clean typed error; D39: tables aliased, columns
-- qualified. D38 N/A (no extension calls). D45 N/A (fresh CREATE, no signature
-- change). Proven via a rolled-back transactional probe before this applied.

CREATE FUNCTION public.tg_versions_no_unfreeze_with_responses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'draft'
     AND OLD.status IS DISTINCT FROM 'draft'
     AND EXISTS (
       SELECT 1
         FROM responses AS r
         JOIN invitations AS i ON i.id = r.invitation_id
        WHERE i.questionnaire_version_id = OLD.id
     )
  THEN
    RAISE EXCEPTION
      'cannot move version % back to draft: it has responses; unfreezing would let question edits corrupt collected data',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER versions_no_unfreeze_with_responses
  BEFORE UPDATE ON questionnaire_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_versions_no_unfreeze_with_responses();
