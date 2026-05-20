# Task State — Handoff Snapshot

Last updated: end of Session 3a (2026-05-20) — admin auth live.

Read this first if you're picking up the project cold. It's a synthesis of where we are, what's been decided, and what's next. The canonical docs for each topic are linked inline — when this doc and a canonical doc disagree, the canonical doc wins.

---

## 1. What this project is

**Yarmouk Study Research Platform** — a bilingual (EN/AR) research questionnaire and qualitative-analysis platform supporting a master's thesis in Water Diplomacy. The thesis evaluates the 1987 Yarmouk Agreement between Jordan and Syria. The platform is what the researcher uses to send invitations, collect responses, anonymize/code data, and export to ATLAS.ti for analysis.

- **Owner**: Sura Karasneh (researcher, MSc candidate)
- **Read-only admins (supervisors)**: Dr. Mutawakkil Obeidat, Dr. Virginia Tice
- **Respondents**: invited experts across 4 categories (Officials, Researchers, Donors, NGOs); Officials split by nationality (Jordanian, Syrian)
- **Lifespan**: build → pilot (V1) → main collection → thesis defense. Roughly 12 months end-to-end.

See `CLAUDE.md` for the framing, `docs/STATUS.md` for build status, `docs/DECISIONS.md` for the full decision history.

---

## 2. Where we are right now

**Session 2b is COMPLETE** (full public respondent flow, verified live) **and Session 3a is COMPLETE** (admin auth + route protection, verified live). 2b: invitation link → `/r/[token]` → landing → consent (name encrypted) → paginated questionnaire (EN/AR, autosave, resumption, nationality-gated, forward-lock + map) → server-side submit gate → terminal thank-you, re-entry blocked post-submit. 3a: magic-link/OTP sign-in via Supabase built-in email (signup locked down, D49), `(protected)` layout authorization guard + `/admin/*` session-refresh middleware (D50), case-insensitive email matching (D51), `current_admin()` helper, and the Sura owner seed. 8/8 admin-auth smoke tests passed against the live DB (2026-05-20). Migrations 013 + 014 applied (count → 14).

**Dev-admin note:** `salloubani@cybercorrelate.com` is seeded live as a SECOND `owner` for the build (out-of-band, not in any migration). Pre-launch removal blocker — tracked in `docs/STATUS.md` "Known Open Items".

**Next: Session 3b (Invitation management)** — `lib/tokens.ts` (D44: 32 random bytes base64url, SHA-256 hashed), invitation list + create UI, resend/rotate flow, Resend wiring for respondent invitation emails (with the sender-domain pre-launch item in view), and seeding the two supervisor admins (readonly) once their emails are known. Not yet scoped; user wants a deliberate planning pass before implementation.

**Nothing is in flight.** No background processes, no timers, no scheduled work. The repo is in a clean state: working tree matches `origin/main`.

---

## 3. Production state (live)

- **Repo**: `github.com/saeedalloubani/yarmouk-platform` (private)
- **Supabase project ref**: `trvxugvkesfcopwdtdey`
- **Supabase region / tier**: free tier (default Supabase placement)
- **Branch protection** on `main`: force-push blocked, deletion blocked. Direct pushes still allowed (solo phase).
- **Vault state**: `pii_key_v1` exists. Verified `decryptable=true`. Backed up in Owner's password manager as `Yarmouk — pii_key_v1 (active)`.
- **Migrations applied**: all 14 (see §5).
- **RLS**: enabled on every table. Helpers `current_admin_role()` and `current_admin_id()` resolve admin identity via JWT email lookup (D37).
- **PII columns ciphertext**: helpers exist (`encrypt_pii` / `decrypt_pii`) but no real PII has been written yet — the only data in user tables is the seed questionnaire content. (2b-2 smoke wrote + cleaned up a test invitation; `inv_left=0`, `resp_left=0`.)
- **Branch protection on Vault**: Studio access is Owner-only; CLI access via `SUPABASE_DB_PASSWORD` (in Owner's env, not in repo).

---

## 4. Approach / architecture in one screen

- **Stack**: Next.js 15 (App Router, TypeScript), Tailwind v3, Supabase (Postgres + Auth + Storage), Resend. Pinned versions in `package.json`.
- **Auth model**: respondents have NO accounts — single-use URL tokens (`/r/[token]`). Admins use magic-link via Supabase Auth.
- **Roles**: exactly two — `owner` and `readonly`. Both routed through the `authenticated` Postgres role; differentiated by `admins.role` looked up via JWT email (D37).
- **PII strategy** (D4, D31, D36):
  - PII columns are pgcrypto-encrypted ciphertext (`*_encrypted` text columns).
  - Encryption key lives in Supabase Vault as `pii_key_v<N>`, accessed only inside SECURITY DEFINER functions.
  - Versioned keys with current-then-previous fallback for rotation.
  - Read-only admins access PII tables via `*_redacted` views; PII columns return NULL through the view. Repos (`lib/repos/*`) enforce the source-table routing.
- **Token model**:
  - Stored as SHA-256 hash (`token_hash`), plaintext never persisted. Resend = mint new token, rotate hash.
  - `validate_invitation_token(p_token)` is SECURITY DEFINER, atomic, supports resumption (returns existing `response_id` if there's a non-submitted response, else fresh-claim path).
- **Questionnaire model**:
  - One `active` `questionnaire_versions` row per variant (enforced by partial unique index).
  - V1→V2 publish is atomic: closes V1, activates V2, regenerates fresh V2 tokens for non-submitted invitations.
  - `visible_nationalities nationality_type[]` on `questions` gates per-respondent visibility (no parallel variants per D32).
- **Audit log**: BEFORE INSERT trigger unconditionally overwrites `ts` and actor fields from the session JWT. Service-role inserts get `actor_name = 'system'`; JWT-with-no-matching-admin inserts get `actor_name = 'unknown'`.

For full architecture, read in this order:
1. `CLAUDE.md` — project framing + tech stack + conventions index
2. `docs/SCHEMA.md` — data model (tables, columns, RLS policies, views)
3. `docs/DECISIONS.md` — every decision and why
4. `docs/CONVENTIONS.md` — TypeScript/SQL/Git/migration review conventions
5. `RUNBOOK.md` — manual operations (Vault key lifecycle)
6. `lib/repos/README.md` — the PII-table data-access pattern
7. `docs/STATUS.md` — build status with session-by-session checklists

---

## 5. Migrations applied (14 total)

All in `supabase/migrations/`, timestamped `YYYYMMDDHHMMSS_name.sql` (per Supabase CLI requirement — `0001_*` naming would be silently skipped). Applied to live DB in order.

| Filename suffix | Purpose |
|---|---|
| `…001_enums.sql` | All Postgres enums + `pgcrypto` extension |
| `…002_tables.sql` | All tables; `token_hash` (SHA-256, no plaintext) + `preferred_language` on invitations |
| `…003_functions.sql` | `current_admin_role()`, `current_admin_id()`, `validate_invitation_token()` (atomic claim + resumption), `audit_log` actor-snapshot trigger |
| `…004_rls.sql` | RLS policies: Owner-all on PII, per-admin on notifications/prefs |
| `…005_views.sql` | `*_redacted` views (invitations, recordings, consent_records) with `security_invoker = true`; readonly SELECT policies co-located with views |
| `…006_indexes.sql` | Partial unique index on `active` `questionnaire_versions` + secondary indexes |
| `…007_settings_seed.sql` | Settings table seed (retention, sender identity, ethics fields) |
| `…008_fix_pgcrypto_qualification.sql` | Forward fix: `extensions.digest(...)` qualifier on `validate_invitation_token` (D38 caught at smoke test) |
| `…009_alias_validate_token_columns.sql` | Forward fix: alias every table reference + qualify every column inside `validate_invitation_token` (D39 caught at smoke test) |
| `…010_pii_encryption_helpers.sql` | `encrypt_pii` / `decrypt_pii` — pgcrypto + Vault, rotation fallback, narrow EXCEPTION clauses (verified SQLSTATEs) |
| `…011_seed_pilot_v1_officials.sql` | 1 active `pilot_officials` v1 questionnaire + 6 Draft variants + 18 questions (14 main Q1-Q14 + 4 feedback F1-F4) |
| `…012_validate_token_creates_response.sql` | Extends `validate_invitation_token` to atomically INSERT the response row on fresh claim + return `response_id` + `ref_code` (D42). DROP-then-CREATE because the return-type change tripped SQLSTATE 42P13 on `CREATE OR REPLACE` (D45). |
| `…013_admin_auth_functions.sql` | Admin auth (3a): CHECK (email = lower(email)) on admins; case-insensitive `current_admin_role`/`current_admin_id`; new `current_admin()` RETURNS TABLE(id,name,role) (D51). |
| `…014_seed_admin_sura.sql` | Seed Sura (owner, active) — app-level role row; auth.users identity hand-provisioned in dashboard (D37/D49). |

Migrations are forward-only. Don't edit applied migrations; write a new migration that fixes forward.

---

## 6. Repo layout

```
.
├── CLAUDE.md                          Project instructions (loaded into every session)
├── RUNBOOK.md                         Manual Vault operations + disaster recovery
├── TASK_STATE.md                      This file — session handoff snapshot
├── README.md                          (placeholder; not yet rewritten)
├── .env.example                       Required env vars w/ comments
├── .nvmrc                             Node 24 pin
├── package.json                       Next 15 + React 19 + Supabase clients
├── tailwind.config.ts                 Tailwind v3, design tokens from mock
├── tsconfig.json                      strict TS
├── eslint.config.mjs                  Next-recommended config
├── postcss.config.js                  v3-style (autoprefixer + tailwindcss)
├── middleware.ts                       @supabase/ssr session refresh on /admin/* (3a; D50)
├── app/
│   ├── (public)/                      Respondent-facing routes (no auth)
│   │   ├── page.tsx                   Landing — variant chooser on getSession() (2b-2)
│   │   ├── invitation-invalid/        Terminal page for bad/expired tokens (2b-2)
│   │   ├── consent/page.tsx           Consent screen — guards + ConsentForm (2b-3)
│   │   ├── questionnaire/page.tsx     Wizard host — filter + initialIdx derivation (2b-3)
│   │   └── submitted/page.tsx         Terminal thank-you (2b-3)
│   ├── admin/                         Admin area (auth required, 3a)
│   │   ├── login/page.tsx             Magic-link login (client; shouldCreateUser:false) (3a)
│   │   ├── callback/route.ts          PKCE code exchange → /admin (3a)
│   │   ├── unauthorized/page.tsx      Authenticated-non-admin notice + sign out (3a)
│   │   └── (protected)/               Guarded subtree (login/callback/unauthorized sit OUTSIDE)
│   │       ├── layout.tsx             Auth guard: getUser → getCurrentAdmin → redirect tree (3a; D50)
│   │       └── page.tsx               Auth-proof landing ("Signed in as {name} ({role})") (3a)
│   ├── api/                           (empty; route handlers go here)
│   ├── r/[token]/route.ts            Public token entry: RPC → cookies → redirect (2b-2)
│   ├── globals.css                    Tailwind base + design tokens
│   ├── layout.tsx                     next/font (Plus Jakarta, IBM Plex Arabic, JetBrains)
│   └── favicon.ico
├── components/
│   ├── LandingNoSession.tsx           Bilingual courtesy page (no session cookie) (2b-2)
│   ├── LandingInvited.tsx             Single-language invited landing (2b-2)
│   ├── LanguageSwitcher.tsx           Client: optimistic lang toggle via Server Action (2b-2)
│   ├── ConsentForm.tsx                Client consent form — required audio radio (2b-3)
│   └── QuestionnaireWizard.tsx        Client wizard — autosave, flush-on-boundary, map (2b-3)
├── lib/
│   ├── auth.ts                        getCurrentAdminRole + getCurrentAdmin(id,name,role) — RPC wrappers (3a)
│   ├── cookies.ts                     getLang/setLang + getSession/setSession/clearSession(+Cookie) (2b-2/2b-3; D41)
│   ├── i18n.ts                        Canonical Lang + translations + LANG_PICKER_LABELS (2b-2/2b-3)
│   ├── actions/
│   │   ├── setLang.ts                 Server Action wrapping setLang for client use (2b-2)
│   │   ├── consent.ts                 submitConsent — validate + encrypt_pii + insert (2b-3)
│   │   ├── answers.ts                 saveAnswer (autosave + opened→started) + submitQuestionnaire (2b-3)
│   │   └── auth.ts                    signOut Server Action (3a)
│   ├── supabase/
│   │   ├── server.ts                  createSupabaseServerClient (RSC + Server Actions + admin route handlers)
│   │   ├── client.ts                  createSupabaseBrowserClient (use client)
│   │   ├── admin.ts                   createSupabaseAdminClient (service role; throws on browser import)
│   │   ├── middleware.ts              updateSession — @supabase/ssr token refresh for /admin/* (3a)
│   │   └── database.types.ts          Generated by `npm run db:types` from live schema
│   ├── repos/
│   │   ├── README.md                  Repo pattern doc + PII-required allow-list
│   │   ├── invitations.ts             Owner→base, Readonly→invitations_redacted
│   │   ├── recordings.ts              Owner→base, Readonly→recordings_redacted
│   │   ├── consent.ts                 Owner repos + public-flow helpers (consentExists/insert) (2b-3)
│   │   ├── questions.ts               Public-flow getVisibleQuestions (nationality filter; D48) (2b-3)
│   │   └── answers.ts                 Public-flow getAnswersMap/getAnsweredQuestionIds/upsertAnswer (2b-3)
│   ├── exports/                       (empty; Session 4 export tooling)
│   └── encryption.ts                  NOT created — consent action calls admin.rpc("encrypt_pii") directly (one call site)
├── supabase/
│   └── migrations/                    14 timestamped migration files (see §5)
└── docs/
    ├── SCHEMA.md                      Canonical data model
    ├── DECISIONS.md                   D1-D51 decision history with rationale
    ├── CONVENTIONS.md                 TypeScript/SQL/Git/migration conventions
    └── STATUS.md                      Session-by-session build status + Notes
```

---

## 7. Decisions register (D1-D51)

Full text in `docs/DECISIONS.md`. One-line summaries grouped by topic:

**Identity & Access (D1-D4)**
- D1: Respondents → tokens, not accounts
- D2: Admins → magic-link auth
- D3: Two roles only (owner, readonly)
- D4: Anonymization enforced at the database, not just the UI

**Data & Schema (D5-D7)**
- D5: Pseudonymous `ref_code` (e.g., `OFF-J-04`) in admin UI, not UUIDs
- D6: Column-level encryption on PII, not whole-row
- D7: `answers.word_count` is a generated stored column

**Questionnaires (D8-D11)**
- D8: 7 variants (2 pilot + 5 main), not "one with conditions"
- D9: Pilot has F1-F4 feedback block; Main does not
- D10: Strict version freezing on first response
- D11: V2 publish atomically migrates non-submitted invitations

**Questionnaire Behavior (D12-D14)**
- D12: Required-answer validation, can't skip
- D13: Autosave on every keystroke (debounced)
- D14: Language picker on first screen, persists in localStorage (later refined to cookie per D30)

**Recordings & Transcripts (D15-D17)**
- D15: Audio is storage only; the published transcript is the data
- D16: Anonymization happens before publication
- D17: Bulk import supports both Q-by-Q and free-form transcripts

**ATLAS.ti Integration (D18-D20)**
- D18: Survey Import `.xlsx` format, not REFI-QDA, as primary export
- D19: Platform tags become starter codes in ATLAS.ti
- D20: Audio NOT exported (only published anonymized transcripts)

**Communications (D21-D23)**
- D21: Resend for email
- D22: Per-template BCC owner toggle + global override
- D23: Notifications: in-app bell + email, separately toggleable

**Security & Auditing (D24-D26)**
- D24: Audit log retained 2 years
- D25: Security log is Owner-only
- D26: IP + geo + device captured for every admin action

**Operations (D27-D29)**
- D27: Daily automated backups, 30-day retention, with pinning
- D28: Backup format: one encrypted `.yarmoukbackup` file
- D29: Vercel + Supabase free tiers chosen deliberately

**Architecture, Session 1 (D30-D32)**
- D30: Language is cookie-based, with token-entry fallback (not React context)
- D31: PII tables accessed only via `lib/repos/*` helpers
- D32: Nationality-conditional questions use `visible_nationalities[]`, not parallel variants

**Build Foundation, Session 1 (D33-D35)**
- D33: Self-hosted fonts via `next/font/google`, not `@import url(...)`
- D34: Pinned to Next 15, not Next 16
- D35: Tailwind v3, not v4

**Crypto & Identity, Session 2a/2b-1 (D36-D39)**
- D36: pgcrypto encryption key lives in Supabase Vault (versioned secrets, current-then-previous fallback)
- D37: Email is the admin identifier in role-resolution helpers
- D38: pgcrypto (and other extension) functions always qualified with `extensions.` — caught the hard way in 0008
- D39: SECURITY DEFINER functions with `RETURNS TABLE` must alias every table ref + qualify every column — caught the hard way in 0009

**Analysis, Session 2b-1 (D40)**
- D40: Compound questions (Q2, Q4 in Pilot V1) code as separate units in ATLAS.ti

**Session 2b-2 (D41-D45)**
- D41: Respondent session cookie is unsigned; DB validation is the integrity check
- D42: Response row is created inside `validate_invitation_token`, not by the caller
- D43: Language resolution — invitation overrides on entry; cookie everywhere else; Accept-Language ignored
- D44: Invitation token plaintext format — 32 random bytes, base64url, no padding
- D45: `CREATE OR REPLACE FUNCTION` cannot change return type — use DROP + CREATE for signature changes (SQLSTATE 42P13)

**Session 2b-3 (D46-D48)**
- D46: Questionnaire is a one-question-per-page wizard; position derived (first-unanswered-visible), not stored
- D47: Submit gate enforced server-side over the respondent's visible required set, never client-trusted
- D48: Public respondent-flow data access uses the service-role admin client (or SECURITY DEFINER), never anon RLS

**Session 3a (D49-D51)**
- D49: Supabase Auth public signup locked down — only pre-authorized admin emails can authenticate
- D50: Admin auth architecture — middleware refresh + `(protected)` layout guard; magic-link via built-in email; no enumeration
- D51: Admin email matching is case-insensitive (`lower()` + CHECK); UNIQUE(email) becomes effectively case-insensitive

---

## 8. Conventions to follow

Full text in `docs/CONVENTIONS.md`. Load-bearing ones the next session needs to know without reading the file:

- **TypeScript strict**. No `any` unless commented why.
- **Server Components by default.** Mark `"use client"` only when needed.
- **Server Actions** for all mutations from admin UI; **Route Handlers** only for downloads, webhooks, anonymous public endpoints.
- **Tailwind only**, no CSS-in-JS, design tokens not raw hex.
- **Logical CSS properties** (`ms-`, `pe-`, etc.) for RTL.
- **PII tables (`invitations`, `recordings`, `consent_records`)** accessed only via `lib/repos/*`. Direct `supabase.from()` calls prohibited for these.
- **Database fields**: `snake_case`. **TypeScript fields**: `camelCase`. Mapping happens at the repo layer.
- **Migration review checklist** before applying any migration that adds/modifies a SECURITY DEFINER function:
  1. D38 grep — pgcrypto unqualified call check (see DECISIONS.md for command)
  2. D39 grep — RETURNS TABLE aliasing check (`grep -nE 'RETURNS TABLE' supabase/migrations/*.sql`)
  3. SQLSTATE verify-probe — write a DO block that triggers each EXCEPTION the new code needs to catch, read the actual SQLSTATEs from `GET STACKED DIAGNOSTICS`, then code the handler. Documentation can be stale; the live DB is authoritative.
  4. Write the smoke-test queries BEFORE the migration (CONVENTIONS.md "Database Migrations" section), and run them in Studio after apply.

---

## 9. Concrete values you'll need

**Production**
- Supabase project ref: `trvxugvkesfcopwdtdey`
- Live URL: `https://trvxugvkesfcopwdtdey.supabase.co` (Supabase project URL)
- Supabase Studio: app.supabase.com/project/trvxugvkesfcopwdtdey

**Vault secrets**
- `pii_key_v1` — current pgcrypto encryption key (only this version exists; rotation procedure in RUNBOOK.md)

**Environment variables** (see `.env.example` for full list)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD` — CLI-only, for `supabase db push`
- `RESEND_API_KEY` — not yet configured (Session 3)
- `ENCRYPTION_KEY` — legacy fallback, retained for local dev; production reads from Vault per D36
- `BACKUP_PASSPHRASE` — Owner-chosen, not in env yet (Session 6)
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000` for dev, `https://karasneh-research.org` for prod

**Naming conventions**
- Migration files: `YYYYMMDDHHMMSS_name.sql`. Current latest timestamp range: `2026051917000{1..14}`. Next migration would be `…015_*` or later.
- Vault secrets for PII keys: `pii_key_v<N>`, integer suffix (do not use leading zeros — sort is integer-cast).
- Question codes: `Q1`-`Q14` for main, `F1`-`F4` for feedback.
- Ref codes (anonymized display IDs): `{CAT_PREFIX}-{NAT_PREFIX}-{SEQ}` (e.g., `OFF-J-04`). Per CONVENTIONS.md "Reference Code Pattern".

**Routes**
- `/` — landing, variant chooser on getSession() (LIVE, 2b-2)
- `/r/[token]` — public token entry route handler (LIVE, 2b-2)
- `/invitation-invalid` — terminal page for bad/expired tokens (LIVE, 2b-2)
- `/consent` — consent screen (Session 2b-3)
- `/questionnaire` — paginated one-at-a-time questions (Session 2b-3)
- `/submitted` — thank-you (Session 2b-3)
- `/admin/*` — all admin routes (Session 3+)
- `/api/public/*` — any public route handlers not better expressed as Server Actions (TBD per 2b-3 scoping)

---

## 10. Dev workflow

**Setup from clone**
```bash
nvm use                              # picks Node 24 from .nvmrc
npm install
cp .env.example .env.local           # fill in real values
supabase login                       # if you haven't already
supabase link --project-ref trvxugvkesfcopwdtdey
```

**Daily commands**
```bash
npm run dev                          # next dev on :3000
npm run lint                         # eslint
npm run typecheck                    # tsc --noEmit
npm run build                        # next build (also runs in Vercel CI)
npm run db:types                     # regenerate lib/supabase/database.types.ts from live schema
```

**Migration workflow**
```bash
# Write migration file in supabase/migrations/ with YYYYMMDDHHMMSS_name.sql
# Then:
supabase db push --dry-run           # preview what will apply
supabase db push                     # apply against linked project
# Then smoke-test in Studio SQL Editor.
# If something fails: write a NEW migration that fixes forward; don't edit the applied one.
```

**Git workflow**
- Commit messages: Conventional Commits-ish, e.g., `feat(db):`, `fix(db):`, `docs:`, `chore:`.
- Sign-off line: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Direct pushes to `main` allowed (solo phase). Branch protection prevents force-push and deletion.
- Each session's work is broken into multiple focused commits (e.g., Session 2b-1 = 5 commits: RUNBOOK, encrypt/decrypt, doc-tracking, seed, close-out).

---

## 11. Watch-outs (lessons learned the hard way)

These are in `docs/STATUS.md` Notes section and `docs/DECISIONS.md` D38-D39, but worth flagging here:

1. **Supabase CLI requires timestamp migration names.** `0001_*.sql` will be silently skipped. Use `YYYYMMDDHHMMSS_*.sql`.
2. **pgcrypto lives in `extensions` schema, not `public`.** All pgcrypto calls inside SECURITY DEFINER functions with locked `search_path` MUST be qualified `extensions.foo(...)`. Otherwise lazy-compile lets them through CREATE FUNCTION and they fail at first call.
3. **RETURNS TABLE makes column names implicit OUT parameters.** Bare references to same-named columns inside the function body are ambiguous. Always alias tables and qualify columns inside any SECURITY DEFINER function that reads from tables.
4. **PG named aliases for SQLSTATE classes are NOT interchangeable across classes.** `external_routine_exception` is 38000; `external_routine_invocation_exception` is 39000. pgcrypto raises 39000. Probe SQLSTATEs from the live DB before coding EXCEPTION clauses.
5. **PG view metadata strips NOT NULL info.** Generated `*_redacted.Row` types from `npm run db:types` are uniformly nullable even when the base columns are NOT NULL. Repo mappers cast `row as DbRow` to recover schema reality. Documented in mapper comments.
6. **CHECK constraints aren't reflected in generated types.** `preferred_language` is `string` in generated types even though the DB CHECK enforces `'en' | 'ar'`. Repos narrow via `as 'en' | 'ar'` cast at the mapper boundary.
7. **Vault secrets aren't migration-managed.** Bootstrap via Studio UI before migrations that reference them. Rotation also via Studio (or Vault API). Document in RUNBOOK.md.
8. **`encrypt_pii('')` produces non-NULL ciphertext.** Empty string is distinct from NULL. Don't compress them in app code.
9. **`validate_invitation_token` is resumption-aware.** Don't assume a successful call means "fresh response" — check the returned `response_id`. Null = fresh, non-null = resume.
10. **Email resend requires token rotation** (since plaintext is never stored). Mint new plaintext, hash it, UPDATE `invitations.token_hash`. The old link stops working — intentional, documented in Task #11 reminder.
11. **`CREATE OR REPLACE FUNCTION` can't change return type.** Adding/removing/reordering a `RETURNS TABLE` column (or changing a scalar return type) is rejected at push time with SQLSTATE 42P13. Use `DROP FUNCTION IF EXISTS …(exact-arg-types); CREATE FUNCTION …` + restate REVOKE/GRANT. Check `pg_depend` first to confirm no dependents. Body-only changes still use `CREATE OR REPLACE`. (D45, caught on migration 012.)

---

## 12. What's next: Session 3b (Invitation management)

**Not yet scoped.** User wants a deliberate planning pass before implementation. Session 3 is split like 2b; **3a (admin auth) is done** — see §2. Candidate 3b scope:

- `lib/tokens.ts` — invitation token minting per D44 (32 random bytes base64url, SHA-256 hashed; plaintext into the email, hash into `invitations.token_hash`). This is the deferred generator referenced by D44; Task #11 (resend = token rotation, user-facing notice) lands with the invitations UI. **First writer of invitation PII** → likely the second `encrypt_pii` consumer, so consider extracting `lib/encryption.ts` here (see note below).
- Invitations manager (create, send, resend/rotate, filter, shareable link) — Owner-only writes through `lib/repos/invitations.ts` (already exists from 2a).
- Resend wiring for **respondent invitation emails** (auth magic links stay on Supabase built-in email per D50). Keep the sender-domain pre-launch item in view (STATUS.md "Known Open Items").
- Seed the **two supervisor admins** (readonly) once their emails are known — migration row + dashboard auth.users identities (mirror the 3a Sura bootstrap).

Later Session 3 sub-sessions (3c+): question editor (first writer to `questions`), responses list/detail with tagging + researcher notes, overview dashboard with real queries.

**Note on `lib/encryption.ts`:** the planned thin RPC wrapper was NOT created in 2b-3 — the consent action calls `admin.rpc("encrypt_pii", …)` directly (one call site). 3b's invitation minting is the likely second consumer (recipient name/email PII); extract the wrapper then.

**Admin-auth foundation 3b builds on (from 3a):** `getCurrentAdmin()` / `getCurrentAdminRole()` (lib/auth.ts), the `(protected)` layout guard, `/admin/*` middleware refresh, and the `requireRole`-style gating that admin Server Actions will need (to be added — lib/auth.ts already anticipates it in a comment).

When starting 3b, expect the user to first ask for a scope-narrowing pass (like every prior session). Don't dive into implementation without explicit scope agreement. The established per-file rhythm: decisions surfaced → draft shown → user redlines → save → typecheck/lint/build green → commit; separate commits for separate concerns; deferred doc items batched; probe the live DB before encoding assumptions into migrations.

---

## 13. Open tasks (carried forward)

These exist in the task list and are scoped for future sessions:

- **Task #9** — Remind Owner to connect Vercel + set Node 24 in project settings before any deploy. Not yet wired to Vercel; will surface when we approach Session 7 (or earlier if Owner wants preview deploys).
- **Task #11** — Session 4 admin docs: "Resend invitation" requires token rotation. Document in the Invitations admin UI as user-facing notice.

**Closed:** Task #10 (`opened`→`started` transition) — done in Session 2b-3 as an idempotent guarded UPDATE in the `saveAnswer` action (fires on first answer, smoke E verified). Task #12 (SQLSTATE-verify note) — done at 2b-1 close-out; note in `docs/STATUS.md` cross-session observations.

---

## 14. Process for future sessions

The user (Owner) has a consistent collaboration pattern across sessions. Following it closely is load-bearing:

1. **Scope narrowing first.** Don't start implementation until scope is explicitly agreed. The user will define IN-SCOPE / OUT-OF-SCOPE per session.
2. **Plan before write.** Show SQL, file contents, or design before saving / committing. The user redlines before applying.
3. **Smoke-test after apply.** Per CONVENTIONS.md "Database Migrations": any new SECURITY DEFINER function gets at minimum one smoke-test query. Smoke runs after `supabase db push`, not before.
4. **Forward-fix migrations.** Once a migration is applied (locally or remote), do not edit it. Write a new migration that fixes forward.
5. **Separate commits for separate concerns.** The user explicitly prefers data-only commits separate from code commits separate from doc commits.
6. **Confirmations land in the same turn.** Don't say "I'll do X" without doing X in the same turn — process note from Session 2a.
7. **Flag deferrals explicitly.** If skipping something asked for, say so explicitly: "I considered X but didn't because Y." Silent omission is the failure mode the user calls out.
8. **Verify before assuming.** SQLSTATEs, Vault accessibility, error class names, etc. — probe the live DB, don't rely on documentation or memory.

---

## 15. If something goes wrong

- **Encryption key disaster recovery** → `RUNBOOK.md` "Disaster recovery: lost encryption key" section. Check password manager FIRST.
- **Migration failure** → halt; write a forward-fix migration. Don't edit applied migrations.
- **Type drift after schema change** → `npm run db:types` regenerates types; repo mappers may need cast updates (pattern documented in each mapper).
- **Lost session context** → re-read this file (`TASK_STATE.md`) + `docs/STATUS.md` + the latest commit messages (`git log --oneline -20`).

---

*This file is updated at session-close, not mid-session. If you're picking up cold and this looks stale, check `docs/STATUS.md` and the most recent commits — those are the more current sources.*
