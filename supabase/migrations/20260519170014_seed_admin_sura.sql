-- 20260519170014_seed_admin_sura.sql
--
-- Seed the Owner admin (Session 3a). DATA ONLY — this is the app-level
-- role allow-list row, NOT a Supabase Auth identity. Sura's auth.users
-- identity is provisioned by hand in the dashboard (see RUNBOOK.md
-- "Admin auth bootstrap"); the two are linked by email (D37).
--
-- status='active' + activated_at are set explicitly: the column default is
-- 'pending', which current_admin_role()/current_admin() filter out (would
-- resolve role NULL → /admin/unauthorized). Email is lowercase, satisfying
-- the admins_email_lowercase CHECK from migration 013. ON CONFLICT makes
-- re-apply safe.
--
-- Supervisors (two readonly admins) are seeded in Session 3b once their
-- emails are known.

INSERT INTO admins (email, name, role, status, activated_at)
VALUES ('sjkarasneh24@eng.just.edu.jo', 'Sura Karasneh', 'owner', 'active', NOW())
ON CONFLICT (email) DO NOTHING;
