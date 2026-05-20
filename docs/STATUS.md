# Build Status

Last updated: end of Session 2b-2.

## Where We Are

**Phase**: Respondent entry flow live; entering consent + questionnaire.

Session 1 (scaffold + design system), Session 2a (DB schema + RLS + repo pattern + types), Session 2b-1 (encryption helpers + Pilot V1 seed), and Session 2b-2 (token route + cookies + public-flow landing) are complete. Production Supabase project is linked; 12 migrations applied via `supabase db push` with smoke tests passing. A respondent can now click an invitation link, get an atomically-claimed response row, land on a session-aware bilingual landing page, and switch language. Session 2b-3 (consent page + questionnaire + autosave + `opened`→`started` transition) is next.

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

Nothing in flight. **Session 2b** (public respondent flow) and **Session 3a** (admin auth) and **3b-i** (invitation minting + list + create + audit) are complete and verified live. Next is **Session 3b-ii** (Resend invitation emails + resend/token-rotation), scoped in its own planning pass before implementation begins.

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

### Session 2b-2 — Token route + cookies + public-flow landing
- [x] **Migration `…012_validate_token_creates_response.sql`** — extends `validate_invitation_token` to atomically INSERT the response row on fresh claim and return `response_id` + `ref_code` (D42). Rewritten as DROP-then-CREATE after `CREATE OR REPLACE` was rejected with SQLSTATE 42P13 (return-type change) — locked in as D45. Three smoke scenarios green (fresh claim, resumption, already-submitted); types regenerated.
- [x] **`lib/cookies.ts`** — typed `getLang`/`setLang` (`yarmouk_lang`) + `getSession`/`setSession`/`clearSession` (`yarmouk_session`). Session cookie is unsigned; integrity via DB hydration on every `getSession()` read (D41). Uses the admin client for the hydration lookup (responses RLS blocks anon SELECT); read-only by contract.
- [x] **`lib/i18n.ts`** — 36 translations (mock + 2 inline-mock) + `LANG_PICKER_LABELS`; `Lang` lifted here as canonical, re-exported from `cookies.ts`. Five strings deferred for pre-launch Arabic (see "Known Open Items").
- [x] **`app/r/[token]/route.ts`** — anon-client RPC, branch on empty/error/success, set cookies, redirect (`/` on success, `/invitation-invalid` on failure). Lang cookie overridden on every entry per D43.
- [x] **`app/(public)/invitation-invalid/page.tsx`** — terminal bilingual page, no internal navigation, mailto with pre-filled subject.
- [x] **`app/(public)/page.tsx` + `components/LandingNoSession.tsx` + `components/LandingInvited.tsx`** — server-side variant chooser on `getSession()`: no-session bilingual courtesy page vs invited single-language flow.
- [x] **`components/LanguageSwitcher.tsx` + `lib/actions/setLang.ts`** — client component with optimistic UI (useTransition + useState, reverts on failure), backed by a Server Action wrapping `setLang` with runtime input validation.
- [x] **End-to-end smoke passed 6/6** (2026-05-20): token claim, response creation, language switch, D43 resumption override, garbage-token terminal page, no-session landing. Test invitation cleaned up (`inv_left=0`, `resp_left=0`).
- [x] **Decisions locked**: D41 (unsigned session cookie), D42 (response created inside the RPC), D43 (language resolution + resumption trade-off addendum), D44 (token format), D45 (DROP-then-CREATE for return-type changes).

### Session 2b-3 — Consent + questionnaire + autosave + submit (respondent flow complete)
- [x] **Consent flow** — `app/(public)/consent/page.tsx` (session guard + consent re-entry guard) + `components/ConsentForm.tsx` (required audio radio with no default, two required checkboxes, name) + `lib/actions/consent.ts` (`submitConsent`). Signed name encrypted via `encrypt_pii` through the service-role admin client — **first live exercise of the encryption boundary in the application** (smoke C confirmed encrypt→decrypt roundtrip = "Smoke Jordan").
- [x] **Questionnaire wizard** — `components/QuestionnaireWizard.tsx`: one question per page (D46), debounced autosave with flush-on-every-boundary (Edge 1), forward-lock + question map over the filtered set (D12 / Edge 3), mid-flow language switch with flush-before-refresh (Edge 1.5). Server page `app/(public)/questionnaire/page.tsx` filters by nationality once and derives `initialIdx` = first-unanswered-visible (Edge 2).
- [x] **Submit gate** (D47) — `submitQuestionnaire` re-derives the visible required set server-side and confirms each non-empty before finalizing; client gate is UX-only.
- [x] **Public-flow data access via admin client** (D48) — `lib/repos/questions.ts`, `lib/repos/answers.ts`, public-flow helpers in `lib/repos/consent.ts`; no anon RLS, scoped to the session's `response_id`.
- [x] **Submitted page** — `app/(public)/submitted/page.tsx`: terminal thank-you, session-only cookie clear (`clearSessionCookie`) preserving lang so it renders in the respondent's language.
- [x] **`opened` → `started` transition** on first answer save (idempotent, guarded) — **Task #10 CLOSED**.
- [x] **All 12 smoke tests passed against the live DB** (2026-05-20): token→consent→eager-response (A), consent gate (B), encryption roundtrip (C), Jordanian 14-q map without Q10–Q13 (D), autosave + status flip (E), EDGE-1 flush (F), resumption at first-unanswered (G), incomplete-blocked (H), finalize (I), post-submit re-entry blocked (J), Syrian 18-q map with Q10–Q13 (K), language-switch-position + EDGE-1.5 flush (L). Test invitations cleaned up, cascade confirmed 0 leftover.
- [x] **Decisions locked**: D46 (one-per-page wizard, derived position), D47 (server-side submit gate), D48 (admin-client public-flow access).

### Session 3a — Admin auth + route protection
- [x] **Magic-link / OTP sign-in** via Supabase built-in email — `app/admin/login` (`signInWithOtp`, `shouldCreateUser:false`, no enumeration), `app/admin/callback` (PKCE code exchange), `lib/actions/auth.ts` (`signOut`). Signup locked down (D49).
- [x] **Route protection** — `app/admin/(protected)/layout.tsx` authorization guard (getUser → getCurrentAdmin → redirect tree) + `middleware.ts`/`lib/supabase/middleware.ts` session refresh on `/admin/*` (D50). `login`/`callback`/`unauthorized` sit outside the guarded group.
- [x] **Migration 013** — case-insensitive `current_admin_role`/`current_admin_id` + new `current_admin()` (id,name,role) + `CHECK (email = lower(email))` (D51). **Migration 014** — Sura owner seed (auth.users identity hand-provisioned in dashboard).
- [x] **8/8 admin-auth smoke tests** green against live DB. Decisions: D49, D50, D51.

### Session 3b-i — Invitation minting + list + create
- [x] **`lib/tokens.ts`** — `mintInvitationToken()` per D44 (32 random bytes → base64url; SHA-256 hex hash; plaintext never stored).
- [x] **Invitation create** — `lib/actions/invitations.ts` (`createInvitationAction`): owner gate (app check + RLS backstop + forbidden-attempt audit) → zod validate → mint → `encrypt_pii` via the owner's authenticated client → insert → audit → return one-time `/r/<token>` URL (D52, D53). `components/InvitationCreateForm.tsx` + `app/admin/(protected)/invitations/new/page.tsx` (owner-asserted, loads active versions).
- [x] **Invitation list** — `app/admin/(protected)/invitations/page.tsx`: existing repo role-branch (owner→base, readonly→redacted), non-PII columns only, owner-only "+ New".
- [x] **Audit infrastructure** — **Migration 015** `log_audit()` (SECURITY DEFINER, granted to authenticated; trigger snapshots the acting owner, not `'system'`) + `lib/audit.ts` wrapper (D54). Audit is wired from the **first** admin mutation, not retrofitted.
- [x] **6/6 smoke checks** green against live DB (2026-05-20): mint+encrypt+insert with decrypt roundtrip + hash_len=64; audit actor = owner (not `'system'`), non-PII metadata; minted link drove the live respondent flow (sent→opened, use_count 0→1); ref_code uniqueness → `ref_code_taken`; list role-branch + owner-gated "+ New"; owner-gate refuses readonly (UX + route layers). Smoke data cleaned, 0 leftover. Decisions: D52, D53, D54.

## Next — Session 3b-ii (invitation emails + resend/rotation)

**Session 3 is split** (like 2b): 3a (admin auth) + 3b-i (mint/list/create) are **done**; 3b-ii is next. 3b-ii wires **Resend** for respondent invitation emails (the minted `/r/<token>` URL goes into the email instead of the screen), plus the **resend = token-rotation** flow (Task #11 — mint new, rotate `token_hash`, old link dies). Land the `NEXT_PUBLIC_SITE_URL` hardening (Known Open Items) **before** 3b-ii emails anything, and switch the Resend sender off `onboarding@resend.dev`. Later sub-sessions (3c+): responses list/detail with tagging + researcher notes, question editor, overview dashboard.

## After That (Sessions 3–7)

_(All of Session 2 — 2a, 2b-1, 2b-2, 2b-3 — is now in "Done" above. The public respondent flow is complete; what follows is the admin side and operations.)_

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
| Bilingual completeness pass | Pre-launch | Seven i18n strings need Arabic before launch, in **two treatments by a deliberate principle**: **static dead-end page strings get a visible amber-dashed placeholder** (gap obvious during QA, never shown to a respondent mid-task); **interactive in-flow strings get English-fallback** (clear English beats a bracketed sentinel at a moment of friction — the audience reads English). Placeholder set (5): `ethicsFooter` (landing footer, English-only inline), `invalidTitle` + `invalidBody` (`/invitation-invalid`, literal placeholder), `byInvitationOnly` + `contactResearcher` (no-session landing, sentinel in `lib/i18n.ts`, amber-dashed boxes). English-fallback set (2, Session 2b-3): `submitMissingTitle` (submit-with-blanks warning), `consentError` (consent save failure) — `ar` mirrors `en` in `lib/i18n.ts`. Pre-launch remediation: Sura supplies Arabic for all seven; for the placeholder set swap sentinels in + strip amber styling; for the fallback set replace the mirrored `ar` values. Routing rule for any FUTURE deferred key: static dead-end → placeholder; interactive in-flow → English-fallback. All questionnaire/consent chrome (audio section, progress, required hint, map labels) ships fully bilingual — Arabic was verbatim in the mock. |
| a11y — root `<html lang>` resolution | Pre-launch | App-wide root layout pins `lang="en"`. Pages that render Arabic content (`/invitation-invalid` English+Arabic stack; questionnaire when respondent chose Arabic; etc.) should resolve `<html lang>` per-route based on dominant page language. Currently mitigated by inline `lang="ar" dir="rtl"` on Arabic blocks (screen readers pronounce correctly; document-level `lang` is still wrong). Proper fix: dynamic `lang` in the public layout based on `getLang()` for unilingual pages; explicit mixed handling for bilingual pages like `/invitation-invalid`. |
| **DEV ADMIN ACCOUNT — remove before launch (BLOCKER)** | Pre-launch blocker | `salloubani@cybercorrelate.com` is seeded as a **second `owner`** for the duration of the build (dev convenience + backup login). Added out-of-band (live DB + dashboard auth user), **NOT** in any migration — so a from-migrations rebuild never includes it, and the repo seed history stays clean (014 = Sura only). **Before launch MUST remove both halves:** (1) `DELETE FROM admins WHERE email='salloubani@cybercorrelate.com';` and (2) delete the matching `auth.users` identity in the dashboard. End state: Sura is the sole `owner`. Security blocker — do not launch with a second owner the researcher didn't authorize. |
| Resend sender domain | Pre-launch | Auth magic links use Supabase's built-in email (fine for the build). Respondent invitation emails (Session 3b+) will use Resend — before launch, verify the real sending domain (SPF/DKIM/DMARC on `karasneh-research.org`) and switch the sender OFF `onboarding@resend.dev`. The `resend.dev` test sender only delivers to verified addresses, so real invitees wouldn't receive anything. (Overlaps the Session 7 "Resend domain authentication" item — this row is the explicit "don't ship the test sender" reminder.) |
| Supervisor admins (2 × readonly) | Session 3b | Two supervisor admins (Dr. Mutawakkil Obeidat, Dr. Virginia Tice) still need seeding — both `admins` rows (readonly, active) via a 3b migration AND their `auth.users` identities provisioned in the dashboard — once their emails are known. |
| **HARDENING — `NEXT_PUBLIC_SITE_URL` guard (before 3b-ii)** | Before 3b-ii | The create action builds the token URL as `${NEXT_PUBLIC_SITE_URL}/r/<token>`; when the env var is unset it renders `undefined/r/...` rather than failing (caught in 3b-i smoke; added to `.env.local`). Harmless locally, but in production a missing env var would mint **broken links emailed to real officials**. Fix: throw a clear error at mint time if `NEXT_PUBLIC_SITE_URL` is unset. MUST land before 3b-ii sends any email. |
| forbidden-attempt audit verification | Session 3b | `invitation.create.forbidden` (`warn`) audit row is built and composed from live-verified pieces, but not yet observed firing — the page guard bounces a readonly admin before the action runs. Verify the row fires once a real readonly supervisor exists (seed in 3b). |
| InvitationCreateForm Cancel/Back use `<a href>` | Optional polish | Cosmetic — swap to `<Link>` for client-side nav consistency. Lint passes as-is (sibling-route links, not flagged). |

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

### Probe before migrating: service_role function grants (Session 2b-3)

Session 2b-3: probe-before-migration overturned a second confident static read — `service_role` already had EXECUTE on `encrypt_pii`/`decrypt_pii` despite migration 010's bare `GRANT … TO authenticated`, because Supabase grants `service_role` broader function privileges than the migration text implies. Reinforces: the live DB is the authority; `supabase db query --linked` is the probe tool. Avoided shipping a no-op migration 013. Same lesson family as the SQLSTATE probe (2b-1) — verify against the running database before encoding an assumption into a migration.
