-- 20260519170013_admin_auth_functions.sql
--
-- Admin auth foundation (Session 3a). Three changes on the email→role
-- resolution path:
--
-- 1. Case-insensitive email matching (D51). The JWT email claim's casing
--    can't be trusted to match stored email; a silent case mismatch would
--    deny a legitimate admin. We compare lower(email) = lower(jwt email)
--    and add CHECK (email = lower(email)) so stored emails are always
--    lowercase — which ALSO makes the existing UNIQUE(email) effectively
--    case-insensitive (no two rows can differ only by case).
--
-- 2. current_admin() — new SECURITY DEFINER function returning (id, name,
--    role) for the signed-in admin. Needed because admins is Owner-only
--    RLS, so a readonly admin can't SELECT their own name; this returns it
--    via elevated privilege (same rationale as current_admin_role/id).
--
-- Migration review:
--   D38 — lower() is a pg_catalog builtin (always resolvable under the
--         locked search_path); auth.jwt() stays schema-qualified. No
--         unqualified extension calls introduced.
--   D39 — current_admin() aliases `admins AS a` and qualifies every column
--         (a.id / a.name / a.role), so the RETURNS TABLE OUT-params
--         (id, name, role) don't shadow the table columns.
--   D45 — body-only CREATE OR REPLACE on the two existing functions
--         (return types unchanged → no 42P13); current_admin() is a fresh
--         CREATE.

-- Lowercase-storage invariant (also makes UNIQUE(email) case-insensitive).
ALTER TABLE admins
  ADD CONSTRAINT admins_email_lowercase CHECK (email = lower(email));

-- current_admin_role — case-insensitive match
CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS admin_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.role
    FROM admins AS a
   WHERE lower(a.email) = lower(auth.jwt() ->> 'email')
     AND a.status = 'active'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_role() TO authenticated;

-- current_admin_id — case-insensitive match
CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id
    FROM admins AS a
   WHERE lower(a.email) = lower(auth.jwt() ->> 'email')
     AND a.status = 'active'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_admin_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin_id() TO authenticated;

-- current_admin — (id, name, role) for the signed-in admin
CREATE FUNCTION public.current_admin()
RETURNS TABLE (id UUID, name TEXT, role admin_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.name, a.role
    FROM admins AS a
   WHERE lower(a.email) = lower(auth.jwt() ->> 'email')
     AND a.status = 'active'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_admin() TO authenticated;
