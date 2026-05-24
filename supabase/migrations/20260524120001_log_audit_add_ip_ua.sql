-- 20260524120001_log_audit_add_ip_ua.sql
--
-- D26 phase ①: carry request IP + user-agent into audit_log via the
-- log_audit() entry point. The audit_log table already has the ip /
-- user_agent columns (since 20260519170002); they were simply never
-- populated. This adds two params so the app layer (Server Actions /
-- Route Handlers, where next/headers headers() is available) can pass
-- x-forwarded-for + user-agent through to the row.
--
-- WHY DROP + CREATE (not CREATE OR REPLACE):
--   A function's identity is name + argument types. Adding p_ip/p_user_agent
--   makes a NEW signature, so CREATE OR REPLACE would leave the old 4-arg
--   function in place and ADD a 6-arg overload. With the new params
--   defaulted, a 4-arg call could then match BOTH overloads → "function ...
--   is not unique" at call time. DROP the 4-arg function first, then CREATE
--   the 6-arg one, so exactly one log_audit exists. (Related to D45's
--   signature-change rule; here it's overload ambiguity, not return type.)
--
-- The audit_log_fill_actor BEFORE-INSERT trigger is UNCHANGED and needs no
-- change: it only stamps ts + actor_* from auth.jwt(); it never touches
-- ip / user_agent, so the app-supplied values pass straight through.
--
-- Grants: EXECUTE must be re-applied to the NEW signature (grants are
-- per-signature; the DROP takes the old grants with it).
--
-- Review:
--   D38 — no extension calls in the body (plain INSERT). N/A.
--   D39 — no SELECT / table read in the body (plain INSERT); nothing to
--         alias or qualify. The actor lookup lives in the trigger, already
--         D39-compliant from 0003. N/A.
--   D45 — DROP + CREATE used deliberately (see above).

DROP FUNCTION public.log_audit(TEXT, TEXT, event_severity, JSONB);

CREATE FUNCTION public.log_audit(
  p_action      TEXT,
  p_resource    TEXT DEFAULT '',
  p_severity    event_severity DEFAULT 'info',
  p_metadata    JSONB DEFAULT '{}'::jsonb,
  p_ip          TEXT DEFAULT NULL,
  p_user_agent  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO audit_log (action, resource, severity, metadata, ip, user_agent)
  VALUES (p_action, p_resource, p_severity, p_metadata, p_ip, p_user_agent);
$$;

REVOKE EXECUTE ON FUNCTION
  public.log_audit(TEXT, TEXT, event_severity, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.log_audit(TEXT, TEXT, event_severity, JSONB, TEXT, TEXT) TO authenticated;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new public
-- function to anon + service_role too (REVOKE FROM PUBLIC does NOT remove
-- those role-specific grants). Strip them so log_audit is authenticated-only:
-- nothing calls it as anon or service_role (the failed-login path writes via a
-- DIRECT service-role INSERT, not this RPC), and leaving anon EXECUTE would let
-- anyone with the public anon key spam actor='system' rows via /rest/v1/rpc —
-- log-pollution that undercuts the whole security-logging feature.
REVOKE EXECUTE ON FUNCTION
  public.log_audit(TEXT, TEXT, event_severity, JSONB, TEXT, TEXT)
  FROM anon, service_role;
