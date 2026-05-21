-- 20260519170016_tighten_researcher_notes_and_tag_dedup.sql
--
-- Session 3c-ii prerequisite. Two changes, both closing a gap found by
-- reading the LIVE pg_policies (not just the migration source):
--
-- Part 1 (REQUIRED) — researcher_notes are owner-ONLY.
--   The decided permission model (3c-ii) is: tags are owner-writable /
--   supervisor-readable, but researcher_notes are the researcher's PRIVATE
--   working annotations — supervisors do NOT see them at all ("absent, not
--   redacted"). The original rn_admins_select (0004) granted SELECT to
--   ('owner','readonly'), so a read-only supervisor could read note bodies
--   straight from PostgREST (/rest/v1/researcher_notes) regardless of what
--   the UI shows. Hiding the section in the page is not a boundary. This
--   replaces that policy with an owner-only SELECT so the boundary is real
--   at the DB layer. Writes were already owner-only (rn_owner_insert/
--   update/delete) and are left unchanged.
--
-- Part 2 (RECOMMENDED) — case-insensitive tag dedup as a DB invariant.
--   The inline create-or-pick tag flow matches by lower(name) so "Water"
--   reuses an existing "water" instead of fragmenting the coding scheme.
--   Enforcing that only in the app's lower() SELECT leaves a (single-owner,
--   near-impossible) race where two concurrent creates could both insert.
--   A UNIQUE INDEX on lower(name) makes the invariant a DB guarantee and
--   turns the action's 23505 catch into a genuine convergence backstop.
--   The original case-sensitive UNIQUE(name) (tags_name_key, from 0002)
--   stays; this functional index strictly strengthens it.
--
-- Neither change alters a typed column shape, so lib/supabase/database.types.ts
-- does NOT need to regenerate (an RLS policy and a functional index are not
-- part of the generated Row/Insert/Update types).

-- ---------- Part 1: researcher_notes owner-only SELECT ----------

DROP POLICY IF EXISTS rn_admins_select ON researcher_notes;

CREATE POLICY rn_owner_select ON researcher_notes
  FOR SELECT TO authenticated
  USING (current_admin_role() = 'owner');

-- ---------- Part 2: case-insensitive tag-name uniqueness ----------

CREATE UNIQUE INDEX IF NOT EXISTS tags_name_lower_key ON tags (lower(name));
