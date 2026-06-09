-- 20260609120000_invitations_pending_status_and_batch_id.sql
--
-- D98 — bulk-invite DATA LAYER. Two additive schema changes that the
-- batch/pending model needs. ADDITIVE ONLY: no data rewrite, no column drop,
-- no backfill. Legacy invitations keep their current status and get batch_id
-- NULL.
--
--   1. ALTER TYPE invitation_status ADD VALUE 'pending'
--      A new lifecycle value meaning: invitation row created + token/access
--      code minted, but the email has NOT been dispatched. It is OFF-FUNNEL
--      (pre-send) — never counted as "sent", never picked up by the reminder
--      cron, never reaches the validate RPCs as a live row (nobody has the
--      link until D99's drain flips pending -> sent). Bulk-created rows land
--      in 'pending'; D99's paced drain sends them and flips them to 'sent'.
--
--   2. ALTER TABLE invitations ADD COLUMN batch_id uuid (nullable)
--      Groups the invitations created by one bulk upload so D99's progress
--      view can report per-batch (not global) sent/pending/failed. Legacy +
--      single-form invitations have batch_id = NULL (no batch). No FK — a
--      batch is just a shared UUID stamped at create time, not its own table.
--
--   3. CREATE INDEX invitations_batch_id_status_idx (batch_id, status) partial
--      Serves D99's per-batch progress query
--      (COUNT(*) ... WHERE batch_id = $1 GROUP BY status). PARTIAL on
--      batch_id IS NOT NULL so it only indexes batched rows (legacy NULLs are
--      excluded — smaller index, and the progress query always filters on a
--      concrete batch_id). Non-CONCURRENT: the invitations table is pilot-
--      scale (tens of rows), so the brief ACCESS EXCLUSIVE lock is negligible
--      and the statement can stay inside this migration.
--
-- PG NOTES:
--   * ALTER TYPE ADD VALUE is tx-safe in PG12+ as long as the new value is not
--     USED in the same transaction (same caveat as the 'revoked' migration
--     20260527130001). Statements 2 and 3 DO NOT reference 'pending' (a column
--     add + an index on (batch_id, status), not on the new value), so all
--     three coexist in one file safely even if db push wraps it in a tx.
--   * IF NOT EXISTS on all three makes the migration idempotent — safe to
--     re-apply, safe in a partial db push.
--   * Adding a nullable column with no default is metadata-only in modern PG:
--     ZERO existing rows are rewritten.
--
-- DEPLOY ORDER (matters): this migration MUST COMMIT before the code that
-- writes 'pending' / batch_id goes live. Order:
--   1. Saeed backs up production.
--   2. Saeed runs the pre-flight SELECTs (Checkpoint 7 section D) and confirms
--      the 6-value enum, no batch_id column, and the baseline row count.
--   3. Saeed runs `supabase db push` -> this migration commits.
--   4. Saeed re-runs verification (7-value enum incl. 'pending', batch_id
--      present) + `supabase gen types typescript` so database.types.ts (and
--      its Constants export) pick up 'pending'.
--   5. Vercel deploys the code (which now references 'pending' + batch_id).
-- No coordination hazard — the code is additive and the enum value is unused
-- by any live row until D99.

ALTER TYPE invitation_status ADD VALUE IF NOT EXISTS 'pending';

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS invitations_batch_id_status_idx
  ON invitations (batch_id, status)
  WHERE batch_id IS NOT NULL;
