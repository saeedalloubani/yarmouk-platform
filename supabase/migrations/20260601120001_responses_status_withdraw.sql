-- 20260601120001_responses_status_withdraw.sql
--
-- Adds soft-delete lifecycle to responses for participant withdrawal
-- (ethics: consent retraction is reversible at the database level but
-- final at the semantic level — the withdrawal action itself is the
-- record).
--
-- Paired with:
--   lib/actions/responses.ts        (new — withdrawResponseAction)
--   components/WithdrawResponseButton.tsx (new client component)
--   app/admin/(protected)/responses/[id]/page.tsx (new Withdrawal section + header badge)
--   app/admin/(protected)/responses/page.tsx       (Status column + "hide withdrawn" toggle)
--   lib/repos/responses.ts          (select widened: status, withdrawn_at)
--   9 read sites get `.eq("status", "active")` filters across:
--     lib/repos/dashboard.ts      (1 query edit + 2 in-memory child filters)
--     lib/repos/feedback.ts       (1 query edit)
--     lib/actions/invitations.ts  (5 query edits)
--   docs/DECISIONS.md D63 (drafted in same PR)
--
-- WHY soft delete vs hard delete (D63):
--   IRB-friendly: consent_records row survives as cryptographic proof
--   that consent was given; the matching audit_log row at 'alert'
--   severity timestamps the withdrawal. Hard delete would lose the
--   consent moment (only the audit row would remain), reducing the
--   chain-of-custody Sura's ethics committee expects.
--
-- WHY a denormalized `withdrawn_at` column on responses (vs deriving
-- from audit_log): the canonical "who/when" remains in audit_log
-- (action='response.withdraw'); withdrawn_at on the row itself lets
-- the response detail page render "Withdrawn at <ts>" without a
-- cross-table join into a Vault-blind audit surface. Actor is NOT
-- denormalized (one source of truth: audit_log.actor_admin_id).
--
-- WHY the structural CHECK invariant `responses_withdrawn_state_consistent`:
--   same discipline as `one_active_version_per_variant` — make
--   impossible states impossible at the DB layer. status='active'
--   MUST mean withdrawn_at IS NULL; status='withdrawn' MUST mean
--   withdrawn_at IS NOT NULL. The action code's "set both together"
--   invariant becomes a DB-enforced contract: any future code path
--   that flips one without the other gets a 23514 at write time. Cheap
--   structural guarantee, eliminates a future bug surface.
--
-- WHY 'alert' severity (D63): this is the first 'alert'-severity audit
-- action in the codebase. Revoke is 'warn' because it's a pre-data
-- action (locks the link, no submitted answers to remove). Withdraw is
-- the FIRST data-altering admin action that operates on submitted
-- research data — the 'alert' tier was reserved for this class of
-- action; first-use establishes the precedent.
--
-- DEFAULT 'active' backfills every existing response row in-place — no
-- separate data migration step. NOT NULL is safe because the DEFAULT
-- supplies a value for every row, existing and future.
--
-- Constraint names:
--   - `responses_status_check`               (PG auto-name for inline CHECK)
--   - `responses_withdrawn_state_consistent` (explicit name; multi-column)
--   Both follow the convention verified across recent migrations.
--
-- TX-SAFE + IDEMPOTENT. Re-applying is a no-op (IF NOT EXISTS on the
-- columns; the consistency CHECK is wrapped in DROP IF EXISTS + ADD
-- to support re-apply during dev).
--
-- DEPLOY ORDER (matters): this migration MUST commit before the code
-- that adds `.eq("status", "active")` filters deploys. The new filters
-- reference the new column, so without the migration they error at
-- query time. Same lead-the-code rule as 20260527130001 (D61) and
-- 20260531120001 (D22 Stage 2). Natural order:
--   1. Saeed runs `supabase db push` → this migration commits.
--   2. Saeed runs `supabase gen types typescript` against prod →
--      regenerated lib/supabase/database.types.ts picks up the two new
--      columns on the responses Row / Insert / Update types.
--   3. Vercel deploys the code (filters + UI + action).

BEGIN;

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'withdrawn'));

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ NULL;

ALTER TABLE responses
  DROP CONSTRAINT IF EXISTS responses_withdrawn_state_consistent;

ALTER TABLE responses
  ADD CONSTRAINT responses_withdrawn_state_consistent
  CHECK (
    (status = 'active' AND withdrawn_at IS NULL) OR
    (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  );

COMMIT;
