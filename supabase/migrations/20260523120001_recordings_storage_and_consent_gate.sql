-- 20260523120001_recordings_storage_and_consent_gate.sql
--
-- The recordings Storage layer: who may touch audio objects, and the
-- ethics invariant that no audio may exist for a non-consenting participant.
-- Two structural guards, mirroring the questions_draft_only pattern
-- (migration 017): invariants the app must not be trusted to uphold alone.
--
-- ============================================================================
-- PART 1 — Storage RLS on storage.objects, scoped to the 'recordings' bucket
-- ============================================================================
-- storage.objects is SHARED across every bucket in the project and already
-- has RLS enabled (Supabase default-deny). Each policy below therefore MUST
-- carry the bucket_id = 'recordings' predicate in BOTH USING and WITH CHECK —
-- it is load-bearing: without it the policy would leak across to other
-- buckets' objects.
--
-- Owner gets full upload/read/update/delete (FOR ALL). There is deliberately
-- NO read-only policy: readonly admins get NO audio access at all, mirroring
-- recordings_redacted nulling audio_storage_path / audio_filename
-- (migration 005). Under default-deny, the ABSENCE of a readonly policy IS
-- the denial — nothing to add.
--
-- current_admin_role() lives in public; storage policies run in the storage
-- schema, so it is qualified public.current_admin_role().

CREATE POLICY recordings_obj_owner_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'recordings'
    AND public.current_admin_role() = 'owner'
  )
  WITH CHECK (
    bucket_id = 'recordings'
    AND public.current_admin_role() = 'owner'
  );

-- ============================================================================
-- PART 2 — Consent gate on public.recordings
-- ============================================================================
-- Storing audio against a participant who did not consent to audio (or whose
-- consent we never recorded) is an ethics breach, not merely a bug. This
-- makes "audio_consent = true must exist for the response" a DB invariant
-- rather than an app convention — same structural-enforcement rationale as
-- questions_draft_only (017).
--
-- SECURITY DEFINER + locked search_path: the trigger must read
-- consent_records (Owner-only under RLS) regardless of the writer's role, and
-- the pinned search_path blocks a schema-shadow reroute (same rationale as
-- the other SECURITY DEFINER helpers in 003). ERRCODE check_violation (23514)
-- so the app surfaces a clean, typed refusal. COALESCE(NEW, OLD) so the one
-- function is INSERT/UPDATE-safe.

CREATE FUNCTION public.recordings_require_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_audio_consent BOOLEAN;
BEGIN
  -- consent_records.audio_consent is NOT NULL, so a found row yields
  -- true/false and a missing row leaves v_audio_consent NULL.
  SELECT audio_consent
    INTO v_audio_consent
    FROM consent_records
   WHERE response_id = COALESCE(NEW.response_id, OLD.response_id);

  -- Refuse on NO consent row (NULL) OR explicit audio_consent = false.
  -- Allow only when a row exists AND audio_consent = true.
  IF v_audio_consent IS NULL OR v_audio_consent = false THEN
    RAISE EXCEPTION
      'recordings require recorded audio consent for response % (no consent record, or audio_consent = false)',
      COALESCE(NEW.response_id, OLD.response_id)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER recordings_require_consent_trg
  BEFORE INSERT OR UPDATE ON public.recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.recordings_require_consent();
