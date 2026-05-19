# Build Status

Last updated: end of Session 2a.

## Where We Are

**Phase**: Foundation built; entering the respondent flow.

Session 1 (scaffold + design system) and Session 2a (DB schema + RLS + repo pattern + types) are complete. Production Supabase project is linked and all 9 migrations applied via `supabase db push` with smoke tests passing. Session 2b (encryption helpers + public respondent flow) is next — scoped deliberately in a planning pass before implementation, because Vault setup has its own gotchas.

A working v3 visual mock exists at `~/Downloads/yarmouk-mock` on the owner's Mac. It demonstrates every screen and interaction. The production build replaces the mock's hardcoded data with real database queries while preserving every visual and behavioral detail.

## Built (Mock — Visual Only)

All 20 pages designed and clickable in the v3 mock:

**Public**
- Landing + language picker
- Consent (5 sections, signature)
- Questionnaire (one-at-a-time, required-answer validation, autosave indicator, question map)
- Submitted confirmation

**Admin**
- Login (magic-link UI)
- Overview (KPIs, category breakdown, pilot feedback signal, Progress Report button)
- Invitations (list, filters, "+ New" form, shareable link)
- Responses (list, category filters, audio status badge)
- Response Detail (tabs: Main / Pilot Feedback / Recordings / Consent; tagging panel)
- Questionnaires (7 variants, version history)
- Analytics: Per-Question Pivot, Themes & Tags, Timeline (SVG charts), Demographics, Pilot Feedback Hub (with V2 planner)
- Export Center (Executive Report featured, ATLAS.ti featured, REFI-QDA, 6 standard formats)
- Import (template download, anonymization checklist, full field guide, validation preview)
- Email (Templates tab with EN/AR + variables + preview; Configuration tab with Resend setup, sticky test-send panel)
- Security Log (Owner only — KPIs, 5 filters, IP + country flag + device)
- Settings (Team Access + Invite modal, Notification Preferences, Retention, Backup & Restore, Ethics, Domain)

**Reusable components**
- ExportMenu (PNG / PDF / Word dropdown — appears on every dashboard)
- NotificationsBell (header bell with unread badge + dropdown)

## In Progress

Nothing in flight. Session 2b-2 (token route + cookies + public flow) will be scoped in its own planning pass before implementation begins.

## Done

### Session 1 — Foundation (scaffold + design system)
- [x] GitHub repo `saeedalloubani/yarmouk-platform` (private, force-push + delete protection on `main`)
- [x] Next.js 15 + TypeScript + Tailwind v3 (pinned per D34 / D35)
- [x] Design system ported from mock: `tailwind.config.ts`, `globals.css`, tokens, fonts via `next/font` (D33)
- [x] Folder skeleton (`app/`, `lib/`, `components/`, `supabase/migrations/`, `docs/`)
- [x] `.env.example` with `ENCRYPTION_KEY` + `BACKUP_PASSPHRASE` documented as separate secrets
- [x] Placeholder landing at `/` verifies design tokens render correctly

### Session 2a — DB schema + RLS + repo pattern + types
- [x] Supabase project provisioned and linked
- [x] 9 migrations applied via `supabase db push`, timestamped `YYYYMMDDHHMMSS_*.sql`:
  - `…001_enums.sql` — enums + pgcrypto extension
  - `…002_tables.sql` — all tables, `token_hash` (SHA-256, never plaintext) + `preferred_language` on invitations
  - `…003_functions.sql` — `current_admin_role()`, `current_admin_id()`, `validate_invitation_token()` (atomic claim + resumption), `audit_log` actor-snapshot trigger (unconditional overwrite + `system` / `unknown` sentinels)
  - `…004_rls.sql` — Owner-all / read-only-select for PII tables, per-admin for notifications + preferences
  - `…005_views.sql` — `*_redacted` views (invitations, recordings, consent_records) with `security_invoker = true`; read-only SELECT policies co-located with each view
  - `…006_indexes.sql` — partial unique on active `questionnaire_versions` + secondary indexes
  - `…007_settings_seed.sql` — settings table seed (retention, sender identity, ethics fields)
  - `…008_fix_pgcrypto_qualification.sql` — `extensions.digest(...)` qualification fix (D38 caught at smoke test)
  - `…009_alias_validate_token_columns.sql` — RETURNS TABLE column aliasing fix (D39 caught at smoke test)
- [x] Repo pattern in `lib/repos/{invitations,recordings,consent}.ts` (Owner→base, Read-only→redacted view per D31)
- [x] Three Supabase client factories in `lib/supabase/{server,client,admin}.ts`
- [x] TypeScript types generated from live schema via `npm run db:types` (script uses `--linked`)
- [x] Repo mappers reconciled to generated types (cast pattern documented per-file)
- [x] Smoke tests passing: `SELECT * FROM public.validate_invitation_token('not-a-real-token')` returns 0 rows, no error; `pg_get_functiondef` confirms qualifier + aliases intact in live DB
- [x] Decisions locked: D30 (language cookie), D31 (PII repos), D32 (visible_nationalities enum), D36 (Vault for pgcrypto key + versioned rotation), D37 (email-as-admin-id), D38 (`extensions.` qualifier + audit grep), D39 (RETURNS TABLE aliasing + audit grep)

### Session 2b-1 — Encryption helpers + Pilot V1 seed
- [x] **RUNBOOK.md** at repo root — manual Vault operations: first-time setup (`pii_key_v1`), key rotation (`pii_key_v(N+1)`), disaster recovery (backup-check-first ordering, concrete loss inventory grounded in D4)
- [x] **encrypt_pii / decrypt_pii** helpers in migration `…010_pii_encryption_helpers.sql`:
  - Key sourced from `vault.decrypted_secrets`, highest-version-first integer-sorted (not lexical — `pii_key_v10` outranks `pii_key_v2` only via INT cast)
  - Rotation fallback in `decrypt_pii`: tries newest key first, falls back through older versions
  - `EXCEPTION WHEN external_routine_invocation_exception OR invalid_parameter_value` — SQLSTATEs (39000 wrong-key/corrupt, 22023 bad base64) verified via Studio probe before coding the handler
  - Smoke: 11-row Test A all passed; Test B (DO block) raised on corrupt ciphertext as designed
- [x] **Pilot V1 Officials seed** in migration `…011_seed_pilot_v1_officials.sql`:
  - 1 `active` `questionnaire_versions` row (`pilot_officials`, v1) + 6 Draft placeholders for the remaining variants
  - 18 questions (14 main Q1–Q14 + 4 feedback F1–F4), verbatim EN + AR from `~/Downloads/yarmouk-mock/lib/questions.ts`
  - Q10–Q13 carry `visible_nationalities = ARRAY['syrian']` per D32; rest are `NULL`
  - Verified post-apply: 18 / 7 / 1 / 4 counts; visibility query confirms Q10–Q13 = `{syrian}`
- [x] **Decisions locked in**: D38 grep refinement (excludes SQL line-comments — runs cleaner on subsequent audits), D39 (RETURNS TABLE aliasing, applied to encrypt/decrypt review), D40 (compound questions Q2/Q4 code as separate ATLAS.ti units)
- [x] **SQLSTATE verify-probe pattern established** — see Notes section at bottom; caught a class-38 vs class-39 named-alias confusion that would have broken `decrypt_pii`'s rotation fallback in production

## Next — Session 2b-2 (token route + cookies + public flow)

To be scoped in its own planning pass before implementation. Candidate items (likely subject to revision in the planning pass):

- [ ] `/r/[token]` route handler: call `validate_invitation_token` via RPC, branch on `response_id IS NULL` (fresh) vs not-null (resumption), set cookies (`invitation_id`, `response_id`, `lang`), redirect
- [ ] Cookie helpers — typed get/set with secure flags, expiry aligned to invitation `expires_at`
- [ ] `lib/encryption.ts` — thin RPC wrapper around `encrypt_pii` / `decrypt_pii`
- [ ] Public flow pages: landing + language picker, consent (signature → `encrypt_pii` → `consent_records`), questionnaire (one-at-a-time, required-answer validation, autosave Server Action, question map), submitted
- [ ] `opened` → `started` status transition on first answer insert (tracked task #10)
- [ ] EN/AR + RTL working end-to-end
- [ ] Submission triggers thank-you email + admin notifications (or defer to Session 3 with Resend wiring — TBD)

**End state**: A real invitation link Sura can send to herself, click, complete in EN or AR, and see the response land in the DB.

## After That (Sessions 3–7)

_(Session 2 placeholder removed — folded into "Done" (Sessions 2a + 2b-1) above and "Next" (Session 2b-2) below.)_

### Session 3 — Admin Core
- [ ] Magic-link auth via Supabase
- [ ] Admin route protection (middleware)
- [ ] Overview dashboard with real queries
- [ ] Invitations manager (create, send, resend, filter, shareable link generation)
- [ ] Responses list + detail with tagging + notes
- [ ] Resend email integration with all 5 templates
- [ ] "Send test email" actually sends
- **End state**: Sura logs in, creates an invitation, sends it, sees the response come back

### Session 4 — Analytics + Exports
- [ ] All 5 analytics dashboards with real SQL queries
- [ ] ATLAS.ti `.xlsx` export (real generation via `exceljs`)
- [ ] PNG export per dashboard (`html2canvas` on server)
- [ ] PDF export per dashboard (`pdf-lib`)
- [ ] Word export per dashboard (`docx`)
- [ ] Executive Progress Report generator (Word + PDF)
- **End state**: Every analytical view live; download buttons actually produce files

### Session 5 — Comms + Owner-only
- [ ] Notifications service (write to `notifications`, send emails per preferences)
- [ ] Cron job for stalled invitations (5+ days)
- [ ] Cron job for weekly digest (Monday 09:00 owner-tz)
- [ ] Security Log page with all filters
- [ ] Geo-IP via MaxMind GeoLite2
- [ ] Admin invite flow with role selection + magic-link activation
- [ ] All admin actions write to `audit_log`
- **Open questions**:
  - Geo-IP source: MaxMind GeoLite2 (where does the dataset live on Vercel — Storage? KV?) vs Vercel's built-in `request.geo` (Edge-runtime only, not Node functions) vs a hosted IP API (ipinfo.io / ipapi.co). Decide before wiring `audit_log` IP/country/city columns.
- **End state**: Failed-login attempts produce alerts; bell shows unread count; supervisor can be invited as Read-only

### Session 6 — Recordings + Import + Backup
- [ ] Audio upload (chunked) to Supabase Storage encrypted bucket
- [ ] Whisper API transcription (OpenAI key needed)
- [ ] Anonymization editor + substitution key storage
- [ ] Transcript publication workflow (status pipeline)
- [ ] Bulk Excel import: parse, validate, preview, commit
- [ ] Anonymization warnings (email/phone regex detection)
- [ ] Backup generator (`.yarmoukbackup` ZIP with encrypted contents)
- [ ] Restore flow (validates, archives current state, applies)
- [ ] Daily scheduled backup cron
- **Open questions**:
  - Whisper auto-transcribe vs manual paste-in for `transcript_original`. Auto: requires `OPENAI_API_KEY` + an async worker; pipeline starts at `audio_only`. Manual: simpler scope, pipeline can start at `transcribed`. Ask Sura.
- **End state**: Sura can upload an interview, anonymize the transcript, publish, see it in ATLAS.ti export

### Session 7 — Go-Live
- [ ] Buy `karasneh-research.org` domain (~$12/year)
- [ ] Point DNS to Vercel
- [ ] Resend domain authentication: SPF, DKIM, DMARC records
- [ ] Verify HTTPS + email delivery
- [ ] Smoke test every flow end-to-end
- [ ] Final ethics committee review checklist
- [ ] **Native-speaker Arabic review of all questionnaire text** before first real invitation goes out. Especially Q10-Q13 (political wording: dam estimates, post-conflict water management, Syria's new phase). Reviewer should not be Sura herself — she's too close to the source. Outcome: either greenlight, or list of wording amendments for V2 of pilot questionnaire before pilot launches.
- **Open questions**:
  - Dashboard export tooling: `@vercel/og` for PNG snapshots, `puppeteer-core` + `@sparticuz/chromium` (Vercel-compatible Chromium build) for PDF, `docx` library for Word documents built programmatically from response data (not HTML capture). Confirm before final integration.
- **End state**: Live site, ready for real invitations to be sent

## Known Open Items

| Item | Status | Notes |
|---|---|---|
| Second pilot questionnaire (Researchers/Donors/NGOs) | Not drafted | Sura will provide; can be added to platform after launch |
| 5 Main questionnaires | Not drafted | To be drafted *inside the platform* after pilot validation completes |
| Ethics approval reference number | Pending | Field empty for now; fill via Settings when approval comes through |
| OpenAI Whisper API key | Optional | Owner decides in Session 6 whether to enable auto-transcription |
| Backup passphrase | Decided but not stored | Owner has chosen one; will enter in Session 6 |
| Pilot V1 → V2 wording review | After pilot V1 closes | Read all F1-F3 responses. Specifically look for respondent flags on: Q4 "in any form" absolutism, Q6 "recently" staleness, Q7 unspecified impact list, Q12 "new phase of development" framing. If multiple respondents flag the same issue, incorporate into V2 of pilot questionnaire (D10/D11 atomic-publish flow). |
| Bilingual completeness pass | Pre-launch | Three strings currently render English-only because Arabic was not in the mock and we deferred drafting it: `ethicsFooter` (landing footer), `invalidTitle` and `invalidBody` (`/invitation-invalid` page). Sura writes Arabic; we add the keys to `lib/i18n.ts` before the first real invitation goes out. The landing footer ships English-only with a code comment marking the gap; `/invitation-invalid` ships with a visible Arabic-side placeholder so the gap is obvious to anyone testing. |

## Risks to Watch

- **Resend free tier** (3k/mo). If pilot expands aggressively, we may hit it. Track monthly send count.
- **Supabase free tier** (500MB DB). Transcripts + audio metadata are the heaviest. Audio itself is in Storage (1GB free), but if many interviews are recorded we'll need to upgrade.
- **Vercel build timeouts**. PDF generation can be slow; check Edge Function timeouts in Session 4.
- **MaxMind license**. The free GeoLite2 dataset requires periodic re-download. Set a reminder to refresh quarterly.

## Notes — cross-session observations

Things that surfaced during the build and would help future-me make better calls. None are blockers. None warrant their own decision entry. Just context.

### Vault setup isn't migration-managed

D36 commits us to storing the pgcrypto key in Supabase Vault, but Vault secrets are created via the Studio UI or the Vault API — there's no `INSERT INTO vault.secrets ...` we can write into a migration. The first key must exist *before* the migration that defines `encrypt_pii` / `decrypt_pii` runs, otherwise `vault.decrypted_secrets` returns no row and `pgp_sym_encrypt(plaintext, NULL)` will either error or produce garbage ciphertext (untested — worth checking which during 2b-1 planning).

**Implication for 2b-1's runbook:**

1. Owner creates `pii_key_v1` in Vault via Studio.
2. `db push` applies the migration adding `encrypt_pii` / `decrypt_pii`.
3. Smoke-test that each helper round-trips before any production write uses them.

The Studio step deserves explicit documentation in a runbook (CONVENTIONS.md's Database Migrations section, or a new docs/RUNBOOK.md). Same goes for any future key rotation — it's a Studio action, not a migration.

### SECURITY DEFINER bugs slip past `CREATE FUNCTION`; plan smoke tests upfront

Two of three SECURITY DEFINER bugs in 2a (D38 pgcrypto qualifier, D39 RETURNS TABLE aliasing) shipped through `supabase db push` with no error, then failed at first invocation. The smoke-test discipline now in CONVENTIONS.md caught both — but only because we *ran* the smoke.

For 2b-1's `encrypt_pii` / `decrypt_pii`: **write the smoke-test queries before the migration**, not after. Specific cases to plan:

- Empty input (`encrypt_pii('')`) — does it return ciphertext, NULL, or error?
- Known-good roundtrip — encrypt a sentinel, decrypt, assert equality.
- Rotation fallback — encrypt under `v1`, add `v2`, confirm decrypt still succeeds via the previous-key fallback path.
- NULL input handling — `encrypt_pii(NULL)` behavior should be deliberate, not accidental.

If any of those test cases surface a design gap during planning, that's a planning-phase win. Catching the same gap by debugging a broken `INSERT INTO invitations` is more expensive.

### `as DbRow` casts in the repo mappers are a code smell worth flagging

The Session 2a-closing commit (`efb84b0`) added `const r = row as DbRow` casts in `lib/repos/{invitations,recordings,consent}.ts` to bridge the gap between generated view types (everything nullable, per PG view-metadata rules) and schema reality (non-null per the CREATE TABLE constraints). It's correct at runtime — the view returns base values for unredacted columns — but TypeScript is lying about the runtime shape inside the mapper body.

The cleaner alternative we didn't take: split each mapper in two — `rowToInvitationFromBase(row: DbRow)` and `rowToInvitationFromView(row: DbViewRow)`. The reader functions already branch on role, so they'd call the right mapper. No cast required. Cost: 10–20 lines of duplicated mapping per repo.

Not worth refactoring now. The current code is correct, and a refactor would mean a session of churn for zero observable behavior change. Worth knowing exists if a future contributor (or a future-me reading the mappers cold) wonders about the casts, or if we ever hit a bug where a view column's actual nullability disagrees with our assertion.

### SQLSTATE verify-probe before writing EXCEPTION clauses (end of Session 2b-1)

Session 2b-1: a SQLSTATE-verify probe before writing `decrypt_pii`'s EXCEPTION clause caught a class-38 vs class-39 named-alias confusion (`external_routine_exception` is 38000; pgcrypto raises 39000 = `external_routine_invocation_exception`). Without the probe, the wrong named alias would have shipped, the EXCEPTION clause wouldn't have matched what pgcrypto actually raises, and the rotation fallback in `decrypt_pii` would have been silently non-functional — wrong-key errors would propagate up instead of being caught and retried with the previous key.

The verify-actual-error-codes-before-coding-the-handler pattern generalizes: any future EXCEPTION clause for an unfamiliar error family should be preceded by a DO block that probes SQLSTATE codes from the actual functions, not from documentation or memory. Documentation can be stale; memory is unreliable; the live database is authoritative.

Concrete pattern: write a `DO $$ ... EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS ...` block that calls the function under each failure mode and reports the actual SQLSTATE via `RAISE NOTICE`. Then write the real handler using the verified codes.

### Return-type changes need DROP-then-CREATE, not REPLACE (Session 2b-2, Migration 012)

Session 2b-2 (Migration 012, 42P13 catch): Adding `ref_code` to `validate_invitation_token`'s `RETURNS TABLE` was rejected by `CREATE OR REPLACE FUNCTION` because Postgres doesn't allow return-type changes via REPLACE. Caught at `supabase db push` time, not at function authoring. The pattern: before writing `CREATE OR REPLACE FUNCTION` for any existing function, diff the new `RETURNS` clause against the prior migration's; if they differ, use DROP + CREATE per D45. Same family of lazy-evaluation-trap lessons as D38 (extension qualification) and D39 (RETURNS TABLE shadowing). Defense is reviewer discipline; Postgres won't catch these at write time.
