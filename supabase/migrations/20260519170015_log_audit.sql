-- 20260519170015_log_audit.sql
--
-- log_audit(): single entry point for admin-mutation audit rows (D54).
-- SECURITY DEFINER granted to authenticated — it runs as the function
-- owner so it can INSERT into audit_log (which has NO authenticated
-- INSERT policy; see the RLS comment in 0004), while auth.jwt() inside
-- still resolves the CALLER's JWT (request.jwt.claims is a request-scoped
-- GUC, unaffected by the SECURITY DEFINER role switch — the same
-- mechanism current_admin_role() already relies on, live since 3a). So
-- the existing audit_log_fill_actor BEFORE-INSERT trigger snapshots the
-- ACTING admin, not the 'system' sentinel a service-role insert produces.
--
-- Pure INSERT of (action, resource, severity, metadata). It deliberately
-- does NOT set ts or actor fields — the trigger owns those unconditionally
-- (the 2a overwrite contract). Passing actor fields here would reopen the
-- impersonation hole that contract closes.
--
-- Review:
--   D38 — no extension calls in the body (plain INSERT; the id default
--         gen_random_uuid() is a table default, evaluated by the table).
--   D39 — no SELECT / RETURNS TABLE; nothing to alias. The actor lookup
--         lives in the existing trigger (already D39-compliant from 0003).
--   D45 — fresh CREATE; no return-type-change trap.

CREATE FUNCTION public.log_audit(
  p_action    TEXT,
  p_resource  TEXT DEFAULT '',
  p_severity  event_severity DEFAULT 'info',
  p_metadata  JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO audit_log (action, resource, severity, metadata)
  VALUES (p_action, p_resource, p_severity, p_metadata);
$$;

REVOKE EXECUTE ON FUNCTION
  public.log_audit(TEXT, TEXT, event_severity, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.log_audit(TEXT, TEXT, event_severity, JSONB) TO authenticated;
