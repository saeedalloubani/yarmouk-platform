# Build Status

Last updated: PRODUCTION DEPLOYED + PROVEN LIVE (2026-05-23) at karasneh-research.org; collection loop complete; 19 migrations; UI bilingual + invitation email bilingual. See ## What's Left for the whole-product backlog.

## Where We Are

**Phase**: Deployed + proven live at karasneh-research.org; the collection loop is built and proven; next is the data-USE half (export/analysis).

The full respondent + admin collection loop (invite → email → consent → bilingual questionnaire → submit → view/tag/note) is built, deployed, and smoke-proven in production — **19 migrations** applied, DB true-empty, UI + invitation email bilingual. The remaining work is tiered in **## What's Left** immediately below: **Tier 1** go-live gate (backups + Saeed-removal) before real enrollment; **Tier 2** export/analysis led by the **ATLAS.ti `.xlsx`** export; **Tier 3** operational depth. This section is orientation only — see ## What's Left for the backlog and `TASK_STATE.md` §2 for the feature-by-feature snapshot.

A working v3 visual mock exists at `~/Downloads/yarmouk-mock` on the owner's Mac. It demonstrates every screen and interaction. The production build replaces the mock's hardcoded data with real database queries while preserving every visual and behavioral detail.

## What's Left

**The platform has two halves. The collection half is built and live. The data-USE half (export/analysis) is largely unbuilt — and the ATLAS.ti export is the standout gap.** A cold-start reader should not mistake "deployed + collection loop works" for "done": Sura can collect, but as of 2026-05-23 she cannot yet get her data out for analysis.

**Built & live (the collection loop):** respondent flow (invite → email → consent → bilingual questionnaire → submit), admin Overview, invitations (create/send/resend), responses (list/detail with tags + researcher notes + recordings section), draft question editor, settings (notification prefs only), auth, audit logging (written), email both directions (invitation bilingual). Deployed at karasneh-research.org, 19 migrations, true-empty. See the Done checklists below.

Remaining work, tiered by what it unblocks (NOT by session number):

### Tier 1 — before Sura can ENROLL real participants (hard go-live gate)
- **Backups — v1 SHIPPED + restore-PROVEN (2026-05-24, commit 8a4c69b).** Manual encrypted DB backup: `npm run backup` → encrypted .yarmoukbackup; restore round-trip proven against a throwaway postgres:17 (all 17 public tables count-match live). RUNBOOK "Backup & restore" documents the three-secrets pairing (file + BACKUP_PASSPHRASE + Vault key) and the procedure. REMAINING CAVEATS (not blocking enrollment, but know them): (a) MANUAL — no scheduling (D27 deferred); (b) DB-ONLY — no Storage/audio (text-first; add when interviews recorded); (c) full project-level DR is DOCUMENTED but NOT yet rehearsed end-to-end; (d) OPERATIONAL — each backup must be copied OFFSITE to the Mac (the script writes project-local/gitignored, which is not offsite). The go-live readiness bar is met (a working, proven recovery path exists); the caveats are follow-ons.
- **Saeed-removal** — remove salloubani@cybercorrelate.com from admins (the ethics gate: keeps the consent form's "accessible only to the researcher" true). Last, because it locks Saeed out of dev.
- *(Practical adjuncts: seed supervisor read-only admins — Dr. Obeidat, Dr. Tice — when their emails arrive; rework the recordings upload transport past Vercel's 4.5MB cap ONLY if interviews will be recorded at launch.)*

### Tier 2 — before Sura can ANALYZE (the data-USE half — the platform's actual purpose)
- **★ ATLAS.ti Survey-Import .xlsx export (D18/D19) — TOP PRIORITY after the go-live gate.** WHY THIS IS #1: Sura's entire analysis happens in ATLAS.ti, and she is NOT fluent in it — so this export→import bridge is what makes the collected data usable at all. Without it, collection is a dead end. Format (D18): ATLAS.ti Survey Import .xlsx, one respondent row → one document; (D19) applied platform tags map to ATLAS.ti starter codes via :code:tag:<name> columns. REFI-QDA is a secondary "advanced" option, not the priority.
- **KEY PRIORITIZATION INSIGHT (text-first):** the ATLAS.ti export of the TYPED questionnaire answers is buildable INDEPENDENT of the transcription pipeline. The questionnaire answers are already text → directly exportable per D18/D19. The transcribe→anonymize→publish chain (D15/D16/D20) is only needed to get RECORDED-INTERVIEW audio into the same export. Study is text-first (no audio day-one), so transcription is NOT on the critical path to "Sura can analyze." This makes the #1 deliverable achievable without the heavy transcription build.
- **Basic responses export (CSV/Excel)** — the simpler "get my data out" safety net; smaller than the ATLAS.ti export, good interim.
- **Transcription pipeline (D15/D16/D20) — CONDITIONAL, not blocking.** Only needed IF/WHEN interviews are recorded. Audio is storage-only (D15); only published anonymized transcripts (status: audio_only→transcribing→transcribed→anonymizing→published, D16) count toward stats/export; substitution key owner-only; audio never exported (D20). Open question: Whisper auto- vs manual transcription (unresolved — needs Sura's call). Deferred while text-first.

### Tier 3 — operational depth (does NOT block collection or analysis)
- Analytics dashboards — per-question pivot, themes/tags, timeline, demographics, pilot-feedback hub. Currently the ONLY dashboard is Overview (KPI tiles); none of the deeper views exist.
- Bulk import (D17) — Excel (Q1..Q14 columns + transcript_full) / free-form transcript import; each row → an ATLAS.ti document by ref_code. (Relevant if externally-transcribed interviews need importing.)
- V2 publish flow (D11) — atomic V1-close/V2-activate + regenerate tokens for non-submitted invitees + migration emails. Editor currently makes drafts only; no activate/publish action.
- Audit-log viewer — ✓ DONE (2026-05-24) — owner-only /admin/security viewer (newest-first, LIMIT 100); commits 4c9630e + eb8e086. NOTE: now shows an IP column (D26 ① populates it; user-agent on hover); country/city still omitted (geo resolution ③ deferred).
- Email-template editor (D22) — email_templates table seeded but UNUSED; both emails hardcoded in lib/email/. No editor, no per-template BCC.
- Fuller notifications — only submission_* of 12 preference toggles is wired (invitation-sent/opened, stalled, failed-login, weekly-digest have no triggering feature).
- Settings beyond notifications — ethics-ref entry, retention config (D24), sender identity, team management. settings table seeded; UI does notification prefs only.
- IP/UA capture + login audit (D26 ①+②) — phases ①+② SHIPPED + prod-verified 2026-05-24 (commit 77b00fc): IP/UA capture on all audited actions + admin.login (success, authenticated) + admin.login.failed (service-role, no-session) events. Verified in prod: login + mutation rows show real actor + populated IP. DEFERRED as end-of-project enhancements: ③ country geo (MaxMind resolve-on-read), ④ unknown-email-request failure (needs login-page Server Action refactor; Supabase dashboard logs cover it meanwhile). Anon/service_role EXECUTE on log_audit revoked (authenticated-only).

**Net:** collection loop = done & live. The hard gate to START is now just **Saeed-removal** (backups v1 is shipped + restore-proven 2026-05-24; its caveats are follow-ons, not blockers). The gate to USE the data is Tier 2, led by the ATLAS.ti .xlsx export — and because the study is text-first, that export is buildable without the transcription pipeline.

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

**Nothing mid-flight as of 2026-05-23.** Sessions 1–3, the admin dashboard + sidebar shell, response-submitted notifications, recordings storage + collection_mode, the production deploy, and the bilingual UI + invitation email have all landed and are verified live. There is no in-progress task to resume — the next work is tiered in **## What's Left** (above).

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
- [x] **Magic-link / OTP sign-in** via Supabase built-in email — `app/admin/login` (`signInWithOtp`, `shouldCreateUser:false`, no enumeration), `app/admin/callback` (token_hash + verifyOtp — switched from ?code= PKCE in prod, commit 773e4fe), `lib/actions/auth.ts` (`signOut`). Signup locked down (D49).
- [x] **Route protection** — `app/admin/(protected)/layout.tsx` authorization guard (getUser → getCurrentAdmin → redirect tree) + `middleware.ts`/`lib/supabase/middleware.ts` session refresh on `/admin/*` (D50). `login`/`callback`/`unauthorized` sit outside the guarded group.
- [x] **Migration 013** — case-insensitive `current_admin_role`/`current_admin_id` + new `current_admin()` (id,name,role) + `CHECK (email = lower(email))` (D51). **Migration 014** — Sura owner seed (auth.users identity hand-provisioned in dashboard).
- [x] **8/8 admin-auth smoke tests** green against live DB. Decisions: D49, D50, D51.

### Session 3b-i — Invitation minting + list + create
- [x] **`lib/tokens.ts`** — `mintInvitationToken()` per D44 (32 random bytes → base64url; SHA-256 hex hash; plaintext never stored).
- [x] **Invitation create** — `lib/actions/invitations.ts` (`createInvitationAction`): owner gate (app check + RLS backstop + forbidden-attempt audit) → zod validate → mint → `encrypt_pii` via the owner's authenticated client → insert → audit → return one-time `/r/<token>` URL (D52, D53). `components/InvitationCreateForm.tsx` + `app/admin/(protected)/invitations/new/page.tsx` (owner-asserted, loads active versions).
- [x] **Invitation list** — `app/admin/(protected)/invitations/page.tsx`: existing repo role-branch (owner→base, readonly→redacted), non-PII columns only, owner-only "+ New".
- [x] **Audit infrastructure** — **Migration 015** `log_audit()` (SECURITY DEFINER, granted to authenticated; trigger snapshots the acting owner, not `'system'`) + `lib/audit.ts` wrapper (D54). Audit is wired from the **first** admin mutation, not retrofitted.
- [x] **6/6 smoke checks** green against live DB (2026-05-20): mint+encrypt+insert with decrypt roundtrip + hash_len=64; audit actor = owner (not `'system'`), non-PII metadata; minted link drove the live respondent flow (sent→opened, use_count 0→1); ref_code uniqueness → `ref_code_taken`; list role-branch + owner-gated "+ New"; owner-gate refuses readonly (UX + route layers). Smoke data cleaned, 0 leftover. Decisions: D52, D53, D54.

### Session 3b-ii — Invitation email send + resend/rotation
- [x] **`NEXT_PUBLIC_SITE_URL` guard** — `buildInvitationUrl()` in `lib/tokens.ts` throws if the env var is unset, called BEFORE any write (create) / rotation (resend). Closes the 3b-i "undefined/r/..." launch risk (smoke a: no orphan row on unset).
- [x] **Send-at-create** — `createInvitationAction` gains an optional "Send email now" path (checkbox, default checked). Uses the plaintext email in hand (no decrypt). Email failure is **benign** (invitation exists, URL shown for manual hand-off). `invitation.email_sent` audited **only on success** (smoke b: failed send left no false row).
- [x] **`resendInvitationAction`** (D56) — response-aware token rotation: reads the `responses` table (source of truth), branches submitted→block / in-progress→resume re-send (keeps use_count/status/opened_at) / none→fresh re-send (resets). Loud-failure contract: old link is dead post-rotation, so on email failure the UI surfaces the new `tokenUrl` prominently (`InvitationResendButton` red panel). Owner-gated (+ `invitation.resend.forbidden` audit).
- [x] **Bilingual email helper** — `lib/email/invitation.ts` via the Resend API (D55), separate from Supabase auth SMTP. EN final; AR→EN fallback (pre-launch: Sura's Arabic). Never logs address/URL.
- [x] **5/5 smoke tests** green against live DB (2026-05-20): (a) guard — no orphan on unset SITE_URL; (b) send-at-create — email_sent only on success, metadata PII-free; (c) resend fresh — hash rotated/old link dead/sent·0·null reset/`mode:"fresh"`; (d) **resend resume** — hash rotated BUT use_count/opened_at/status unchanged + answer "RESUME TEST ANSWER 12345" preserved/`mode:"resume"`; (e) resend submitted-block — action-level refusal, hash frozen, no new audit row. Smoke data cleaned, production back to 0/0/0. **No migration** (3b-ii is app-code only). New dep: `resend`. Decisions: D55, D56.

### Session 3c-i — Responses list + detail (PII-redaction boundary)
- [x] **`lib/repos/responses.ts`** — thin **non-PII** read helper (`listResponses`, `getResponse`, `getAnswerCounts`, `getAnswersForResponse`); takes the authenticated server client so RLS applies. No role branch / no redacted view — `responses`/`answers` are on the non-PII allow-list (D31). The respondent's identity context is deliberately NOT read here; it comes from the role-routed invitations/consent repos.
- [x] **Responses list** — `app/admin/(protected)/responses/page.tsx`: ref_code-keyed, **identity-free** (no recipient name → no redaction branch at all on the list). Invitation context (ref_code, category, nationality, status) fetched via the role-routed invitations repo and joined **in memory** — NOT a PostgREST embed, which would hit the invitations base table and leak ciphertext PII to readonly. Non-empty answer count, submitted-first ordering, empty state. "status" = invitation.status (responses has no status column; a display value, not a correctness gate).
- [x] **Response detail** — `app/admin/(protected)/responses/[id]/page.tsx`: **null-driven redaction** — identity values are `ciphertext ? decrypt_pii(ciphertext) : "Redacted"`, computed purely from what the role-routed repos returned, with **zero page-level `if (role === 'owner')`** in the redaction path. Answers (question text + answer text) shown in full to both roles via `getVisibleQuestions` (nationality-filtered, D32) left-joined to answers; consent verification via the consent repo (signed-name redacted for readonly). The cosmetic readonly banner is **fully independent** of the redaction path (the only use of `admin.role`; it gates no data). decrypt failure degrades gracefully (logs + placeholder, answers still render) per RUNBOOK.
- [x] **3/3 smoke states** green against live DB (2026-05-20): owner (full identity + consent name), readonly via SQL role-flip + refresh (name/email/consent-name → "Redacted", banner appears, answers intact), back-to-owner (identity returns) — the privacy boundary flips on `current_admin_role()` with **zero code change**. Smoke data cleaned, production back to 0/0/0. **No migration, no new decision** (app-code only).

### Session 3c-ii — Tagging + researcher notes (annotation layer)
- [x] **Migration 016** `…016_tighten_researcher_notes_and_tag_dedup.sql` (the only 3c migration) — **Part 1** replaces `rn_admins_select` (owner+readonly) with **`rn_owner_select`** (owner-only): reading live `pg_policies` surfaced that readonly supervisors could SELECT `researcher_notes` directly via PostgREST despite the UI hiding the section. **Part 2** adds `tags_name_lower_key` UNIQUE INDEX on `lower(name)` for case-insensitive tag dedup (the existing case-sensitive `UNIQUE(name)` stays). Validated transactionally (execute-then-`ROLLBACK`) before apply; neither change alters typed columns (no `db:types` regen).
- [x] **Tagging** — `lib/repos/tags.ts` + `lib/actions/tags.ts` + `components/ResponseTagEditor.tsx`: **create-or-pick inline** (case-insensitive match reuses an existing tag, else create — backed by `tags_name_lower_key`, with a 23505 convergence backstop), **category required for new tags** (`theme`/`stance`/`perspective`), **idempotent apply** (`(response_id, tag_id)` PK → re-apply is a no-op). Owner-writable / supervisor-readable: both roles SELECT (RLS `t/rt_admins_select`); only the owner gets the add-form + remove (`canEdit` governs rendering only).
- [x] **Researcher notes** — `lib/repos/notes.ts` + `lib/actions/notes.ts` + `components/ResearcherNoteEditor.tsx`: **owner-only**, **one-per-response upsert** (response_id PK). The whole section is wrapped in `{isOwner && …}` on the detail page — **absent (not redacted)** for readonly. A legitimate role gate, distinct from 3c-i's null-driven identity redaction.
- [x] **Write boundary verified at all three layers** — UI hides the controls, the server action owner-gates (+ `*.forbidden` warn-audit for an authenticated non-owner), and RLS (`t/rt/rn_owner_*`) is the DB backstop. Both mutations audit via `log_audit` (D54); the **note body is kept OUT of audit metadata** (chars count only) — confirmed by grepping `audit_log` for the body string = 0 rows.
- [x] **`rn_owner_select` fix verified live** via an owner-vs-readonly contrast **under `SET ROLE authenticated`** (RLS enforced, JWT email claim set so `current_admin_role()` resolves per-admin): readonly read of `researcher_notes` = **0 rows**, owner = **1 row** — the note exists and is genuinely hidden, not missing.
- [x] **3/3 smoke states** green against the live DB (2026-05-21): owner (add tag — create-new + pick-existing — + save note; both persisted with owner-attributed `tag.apply` / `note.save` audit rows; note body absent from metadata); readonly via SQL role-flip + refresh (tags read-only, add/remove gone, **whole notes section absent**, plus the DB-layer 0-vs-1 contrast); back-to-owner (controls + notes return). Smoke data cleaned, production back to 0/0/0. **No new decision** (D-count stays D56).

### Session 3 — Question editor (draft questionnaire content)
- [x] **Migration 017** `…017_questions_draft_only.sql` — the `questions_draft_only` BEFORE INSERT/UPDATE/DELETE trigger makes **D10 a DB invariant**: questions are mutable only on `draft` versions; active/closed are frozen at the database, not by convention. A BEFORE trigger fires regardless of connection role, so no path (editor, direct PostgREST, privileged console, future script) can edit a frozen question. SECURITY DEFINER + locked search_path; `COALESCE(NEW,OLD)`; raises `check_violation` (23514). Intentionally also freezes the active pilot_officials 18. Validated transactionally (draft allowed / active UPDATE+DELETE refused) before apply; trigger only → no `db:types` regen.
- [x] **Repo + actions** — `lib/repos/questionnaires.ts` (authenticated-client version list + UNFILTERED question reads + write helpers; distinct from the public-flow `questions.ts`) and `lib/actions/questions.ts` (create/update/delete/move). Each action: **owner gate (+ `question.*.forbidden` warn-audit) → DRAFT gate (`status==='draft'`, else `frozen`) → zod validate → mutate → `log_audit`** (D54). Create appends `order_index`, unique code per version (`23505→code_taken`), `is_feedback` only on feedback-block versions, empty visibility `[]→NULL` (the all-footgun guard); delete re-sequences to contiguous 1..N; move swaps `order_index` up/down. Audit is lean — code + ids only, **never the EN/AR text bodies**.
- [x] **Editor UI** — `questionnaires/page.tsx` (versions list; active/closed marked "frozen", view-only; drafts open the editor) + `[versionId]/page.tsx` (owner-gated; interactive editor for drafts, read-only frozen view otherwise) + `components/QuestionEditor.tsx` (**bilingual EN+AR, both required**; visibility All→NULL / Jordanian / Syrian / Both; `is_required`; `is_feedback` when allowed; add / inline-edit / delete-with-confirm / up-down; list rendered from props + `router.refresh()` so server order is source of truth). Owner-only **Questionnaires** nav link added to `/admin`.
- [x] **Freeze proven at three layers** — UI shows the active version read-only; the action draft-gate returns `frozen`; the **trigger refused a direct UPDATE *and* DELETE on active questions** (transactional probe, both `check_violation` 23514, active 18 unchanged). **Readonly boundary at four layers** — nav link hidden, editor page redirects readonly → `/admin`, the action owner-gate returns `forbidden` (+warn-audit), and `q_owner_*` RLS refused a readonly INSERT under real RLS (`42501`, `resolved_role=readonly`).
- [x] **Full smoke** green against the live DB (2026-05-21): owner draft CRUD (add EN+AR / edit / reorder / delete + re-sequence) all persisted + audited; active pilot_officials frozen read-only; DB-trigger backstop + readonly boundary proven; smoke data cleaned (6 drafts back to 0 questions, active 18 intact, `question.*` audit rows cleared). **Session 3 is COMPLETE.** No new decision (D-count stays D56).

### Admin dashboard + sidebar shell (operator cockpit)
- [x] **`lib/repos/dashboard.ts`** — null-safe, non-PII read-aggregation. Invitation stats read **`invitations_redacted`** (not the base table) selecting only non-PII columns — **identity-free by construction, no PII embed**; response/answer/tag stats read the non-PII tables (`response_tags→tags` embed is safe, both non-PII). Status-based KPI funnel (invited / submitted / in-progress), completion %, by-category, recent activity (ref_code-keyed). **Avg duration COMPUTED from `submitted_at − started_at`** over submitted responses — the `duration_minutes` column is never populated. At-a-glance: languages, median + avg per-response words, top tag. **Every stat guarded for 0 rows** (0 / 0% / "—" / "No activity yet").
- [x] **`components/AdminShell.tsx` + `(protected)/layout.tsx`** — role-gated sidebar shell wrapped around the existing auth guard. Nav is **role-gated: Questionnaires appended only for owners** (absent from a readonly nav array, not CSS-hidden); page guards remain the enforcement. Replaces the one-off overview nav links. Omits not-yet-built groups (analytics/data/comms/owner-only/settings) + NotificationsBell.
- [x] **`(protected)/page.tsx`** — Overview dashboard replacing the auth-proof stub: KPI cards, completion-by-category bars, recent-activity feed, at-a-glance minis. Deferred/interpretive items **omitted** (Pilot Feedback Signal — can't derive "Q7 flagged by 3/6" from data; Export / Progress-Report / Publish-V2; analytics links) — added in their own future sessions.
- [x] **Smoke** green against the live DB (2026-05-21): empty state reads intentional (0 / 0% / "—" / "No activity yet"); came alive correctly through the full lifecycle (Invited 2, Submitted 1/50%, avg duration computed to 2m, Officials 1/1 100%, ref_code-only activity); readonly drops the Questionnaires nav while the dashboard still renders identity-free. Smoke data cleaned (back to 0/0/0). **No migration** (read-aggregation); D-count stays D56, migration count stays 17.

### Notifications — response-submitted (in-app bell + best-effort email)
- [x] **`lib/repos/notifications.ts` + `lib/notifications.ts` + `lib/email/submission.ts` + `lib/actions/notifications.ts` + `components/NotificationsBell.tsx`** (+ hooks in `lib/actions/answers.ts`, `(protected)/layout.tsx`, `AdminShell.tsx`) — wires the seeded-but-unused `notifications` table for the **response-submitted** event (owner-only). On submit, **`notifyOwnersOfSubmission`** fans out to **all active owners**: an in-app row each + a best-effort email. It is **fire-and-forget and structurally cannot throw** — every step wrapped + logged, hooked AFTER the finalize writes and BEFORE `redirect()` (outside any try wrapping it, since `redirect()` throws `NEXT_REDIRECT`), so a notification failure can never touch the respondent's submit. Insert is **service-role** (RLS-bypass; the no-auth INSERT policy is by design); owner reads via `n_self_select`. **The bell is role-gated, not row-gated** — readonly skips the fetch (layout) AND the render (AdminShell); RLS is identity-scoped, so a flipped owner's rows still match by id but the role gate hides the bell. Content is **identity-free** (ref_code, never the respondent's name). Email reuses the Resend conventions (English; `FROM`/`REPLY_TO` re-declared, `invitation.ts` untouched), returns `{ok}`, fails gracefully under the test sender. Distinct logs: `[notify] in-app write failed` vs `[notify] email send failed`/`threw`. Mark-read/mark-all are owner-gated, **not audited** (D54). Preferences **default-on, not honored this pass** (no rows seeded → no-op).
- [x] **Full smoke** green against the live DB (2026-05-21): submitted NOTIF-1 → **2 in-app rows written, one per active owner** (owner sees only own via RLS), identity-free body, deep-link href; dashboard moved (Submitted 1/50%); submit completed to the thank-you page. **Email half proven graceful** — `ok=true` to the deliverable Resend account address, `ok=false` (recipient-not-verified) to the non-account owner, **submit unaffected either way**, distinct `[notify]` logs. Readonly role-flip → **no bell / no header strip** (role-gated both layers), no leak. Smoke data cleaned to a **true-empty baseline** (0 invitations / responses / answers / consent / notifications; both admins owner). **No migration** — `notifications`/`notification_preferences` + RLS + indexes were purpose-built in 2a (`'submission'` enum, `recipient_admin_id`, `n_self_select`/`update`, service-role INSERT, unread+recent indexes); migration count stays 17, D-count stays D56.

## Next

**Canonical backlog: see "## What's Left" near the top of this file** (2026-05-23, tiered by what unblocks enrollment vs. analysis). Post-deploy update: production is live (karasneh-research.org), and **recordings storage + collection_mode SHIPPED** (Session-6 items, migrations 18–19) — they are no longer "future." The headline remaining work is the Tier-1 go-live gate (backups + Saeed-removal) then the **ATLAS.ti `.xlsx` export** (the analysis bridge, D18/D19). The session-numbered roadmap in "After That" below predates the deploy and is kept for historical context only.

## After That (Sessions 4–7)

_(Sessions 1–3 + the admin dashboard are in "Done" above — **Session 3 — Admin Core is COMPLETE**: magic-link auth, route protection, overview dashboard, invitations manager, responses + detail with tagging + notes, invitation email + resend. Two original Session-3 email items remain and **fold into Session 5 — Comms**: the remaining email templates (reminder1 / reminderFinal / thankYou / v2Migration) and a working "send test email".)_

### Session 4 — Analytics + Exports
- [ ] All 5 analytics dashboards with real SQL queries
- [ ] ATLAS.ti `.xlsx` export (real generation via `exceljs`)
- [ ] PNG export per dashboard (`html2canvas` on server)
- [ ] PDF export per dashboard (`pdf-lib`)
- [ ] Word export per dashboard (`docx`)
- [ ] Executive Progress Report generator (Word + PDF)
- **End state**: Every analytical view live; download buttons actually produce files

### Session 5 — Comms + Owner-only
- [x] **Notifications service — response-submitted event DONE** (in-app bell + best-effort email, owner-only; see "Done" above). **Remaining for Session 5:** the other events (invitation sent/opened, stalled, failed-login, weekly digest), and **honoring `notification_preferences`** + a preferences UI (this pass is default-on, prefs not read).
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

## v1.1 / Post-launch backlog

Deferred to a **v1.1 portal pass after the whole v1 project is complete and live** — NOT the next session.

- **Create-questionnaire-variant UI** — add new variant enum value(s) via migration (keep `variant` as an enum, type-safe, not free text) + a create-draft-version admin form. The 6 seeded draft variants cover the v1 pilot study; new variants (e.g. private sector) are a next-study need. Bundle into a v1.1 portal pass after v1 is live.

## Known Open Items

| Item | Status | Notes |
|---|---|---|
| Second pilot questionnaire (Researchers/Donors/NGOs) | Not drafted | Sura will provide; can be added to platform after launch |
| 5 Main questionnaires | Not drafted | To be drafted *inside the platform* after pilot validation completes |
| Ethics approval reference number | Pending | Field empty for now; fill via Settings when approval comes through |
| OpenAI Whisper API key | Optional | Owner decides in Session 6 whether to enable auto-transcription |
| Backup passphrase | Decided but not stored | Owner has chosen one; will enter in Session 6 |
| Pilot V1 → V2 wording review | After pilot V1 closes | Read all F1-F3 responses. Specifically look for respondent flags on: Q4 "in any form" absolutism, Q6 "recently" staleness, Q7 unspecified impact list, Q12 "new phase of development" framing. If multiple respondents flag the same issue, incorporate into V2 of pilot questionnaire (D10/D11 atomic-publish flow). |
| Bilingual completeness — UI strings | **Done (2026-05-23)** | All 7 landing/error UI strings filled with Arabic (commit d87d1e1): byInvitationOnly, contactResearcher, ethicsFooter, invalidTitle/Body/contact-intro, submitMissingTitle, consentError. Amber placeholder boxes stripped; ethicsFooter wired bilingual (no-session) / active-lang (invited). NOTE: the invitation-EMAIL Arabic copy (lib/email/invitation.ts) is SEPARATE and still EN-fallback — tracked under the Resend row. |
| a11y — root `<html lang>`+`dir` resolution | **Done (polish 2026-05-21)** | Root layout is now `async` and resolves `<html lang>`/`dir` from the `yarmouk_lang` cookie via `getLang()` — `lang="ar" dir="rtl"` for Arabic respondents, `lang="en" dir="ltr"` otherwise (fixes the prior hardcoded `lang="en"`; also activates the previously-dead `[dir="rtl"] body` Arabic-font rule in `globals.css`). Inline `lang`/`dir` on the mixed-language blocks (`/invitation-invalid`, `LandingNoSession`) kept as-is — deliberately granular, not redundant. **Residual (out of scope):** the root reflects the cookie for *all* routes including the English-only admin — realistically covered (admins never go through the respondent picker, so they have no `yarmouk_lang` cookie; `AdminShell` also hardcodes `dir="ltr"`). Full isolation would require splitting into separate root layouts via route groups (a structural refactor). |
| a11y — form-label `htmlFor`/`id` association | Pre-launch (a11y) | Several admin/respondent forms render a visible `<label>` adjacent to their input but don't programmatically associate it via `htmlFor`/`id`: `ConsentForm` (full name, date), `ResponseTagEditor` (Tag, Category), `QuestionEditor` (code, visibility, EN/AR text), `InvitationCreateForm` (recipient/routing fields). Real-but-soft — a sighted user sees the label; a screen reader may not reliably announce it. Distinct from a *missing* label: the bounded polish pass (2026-05-21) added accessible names only to the three genuinely **nameless** controls (researcher-note textarea, resend token-URL input via `aria-label`; questionnaire answer field via `aria-labelledby` to the question heading). Proper fix is an `htmlFor`/`id` association sweep across these forms — bigger than a polish pass. |
| **2nd researcher account — `salloubani@cybercorrelate.com` (dev-only; removed before real data)** | Decided 2026-05-23 (Sura) | Saeed stays as a second `owner` **during DEVELOPMENT only**, then is **REMOVED before any real participant data goes in** — part of the go-live sequence (Production Deployment → "Remaining before real participants", item 2), NOT before deploy (the account is needed during dev). Single researcher at real-enrollment keeps the consent form's "accessible only to the researcher" (singular) true. **Supersedes** the earlier "permanent 2nd researcher" framing. |
| Resend — domain verified + from-swap + invitation-email Arabic | **Done (2026-05-23)** | From-address swapped to noreply@karasneh-research.org in both files (commit d846915); domain verified; delivery proven in prod smoke. Invitation-email Arabic copy shipped (commit e15b01e — redesigned bilingual template). |
| **RECORDINGS UPLOAD — Vercel 4.5MB body cap (BLOCKER)** | Pre-launch blocker | Audio upload works locally via `next.config.ts` `serverActions.bodySizeLimit='50mb'`, but **Vercel caps serverless request bodies at 4.5MB** — real interview audio (35-50min) will be rejected at the platform layer in production. Fix: rework the upload to a **direct-to-Storage signed-upload URL** (browser → Supabase Storage, bypassing the Server Action body). The bucket, `recordings_obj_owner_all` RLS, `recordings_require_consent` trigger, row model, playback, and audit all carry over — only the upload transport (`uploadRecordingAction` + the FormData call in `RecordingsSection.tsx`) changes. |
| Recordings — Storage object deletion is API-only | Op note | `storage.objects` cannot be deleted via SQL (`storage.protect_delete` trigger raises 42501). Use the Storage API `.remove()` (which `deleteRecordingObject` already does). Any future cleanup/backup script must use the API, not SQL DELETE. |
| Supervisor admins (2 × readonly) | Open — Tier-1 adjunct | Two supervisor admins (Dr. Mutawakkil Obeidat, Dr. Virginia Tice) still need seeding — both `admins` rows (readonly, active) AND their `auth.users` identities provisioned in the dashboard — once their emails are known. (Practical adjunct to the go-live gate; see "## What's Left" Tier 1.) |
| `NEXT_PUBLIC_SITE_URL` guard | **Done (3b-ii)** | `buildInvitationUrl()` in `lib/tokens.ts` throws if `NEXT_PUBLIC_SITE_URL` is unset, called before any write/rotation — no `undefined/r/...` links can be minted (smoke a: no orphan row on unset). Prod env var set to `https://karasneh-research.org`. |
| forbidden-attempt audit verification | Session 3b | `invitation.create.forbidden` (`warn`) audit row is built and composed from live-verified pieces, but not yet observed firing — the page guard bounces a readonly admin before the action runs. Verify the row fires once a real readonly supervisor exists (seed in 3b). |
| InvitationCreateForm Cancel/Back use `<a href>` | **Done (polish 2026-05-21)** | Both internal-nav `<a href>` (Cancel + the success-state "← Back to invitations") swapped to Next `<Link>` for client-side nav consistency. |
| Notification preferences — honor toggles + UI | **Done (2026-05-23)** | Shipped: fan-out honors `submission_inapp`/`submission_email` (no-row=ON), Settings UI at `/admin/settings` (owner-only). Commits 293d38d (feat) + c9b3f17 (docs). |
| Notification email — shared Resend helper extract | Later (cleanup) | `FROM`/`REPLY_TO` are file-local consts **duplicated** across `lib/email/invitation.ts` and `lib/email/submission.ts` (deliberately not refactoring a working file this pass). Trivial extract to a shared `lib/email/resend.ts`. **Load-bearing** for the Resend-domain pre-launch item above — until extracted, both copies must change together. |
| Notifications — realtime push | Post-launch (nice-to-have) | The bell updates on page **load/refresh** (`router.refresh()` after mark-read), no websockets / Supabase Realtime. Fine at pilot scale; revisit only if live-push is wanted. |

## Production Deployment

**Status as of 2026-05-23: DEPLOYED + PROVEN LIVE.** The platform is live at https://karasneh-research.org and the full flow is smoke-proven in production. DB true-empty (no real data yet — real enrollment is gated on the go-live sequence below). Remaining before real participants: **Saeed-removal** (the gate that keeps consent's 'accessible only to the researcher' true). Backups v1 is shipped + restore-proven (2026-05-24); its caveats (scheduling, Storage, offsite copy, DR rehearsal) are follow-ons.

### Done

- **Resend sending domain `karasneh-research.org` VERIFIED** (Cloudflare DNS, auto-configured) — ready to send. DKIM `resend._domainkey`, SPF/MX on the `send` subdomain, DMARC `p=none`.
- **Production Supabase project identified: `yarmouk-platform`, ref `trvxugvkesfcopwdtdey`** (Ireland / eu-west-1). Vault key `pii_key_v1` present + decryptable; all 19 migrations applied; DB true-empty. **This is production-to-be.**
- **`yarmouk-study` (ref `zivwlghgrstfjwsywyzb`, Frankfurt) = STALE DEV PROJECT** — test data only (`OFF-J-99`, May 19, pre-current-schema). Safe to delete anytime; not over the project limit so no rush. **NOT production — do not confuse the two.**

### Deploy — done (proven live 2026-05-23)

- **Vercel:** repo deployed, auto-deploys on push to `main`; env vars set against `yarmouk-platform` (ref `trvxugvkesfcopwdtdey`); `NEXT_PUBLIC_SITE_URL=https://karasneh-research.org`. Live with valid SSL.
- **`karasneh-research.org` pointed at Vercel** (Cloudflare DNS-only / proxy OFF — "Proxy Detected" was the gotcha; resolved). SITE domain, separate from Resend's `send` subdomain.
- **Auth bootstrap done:** signups disabled; both auth identities created (Sura `sjkarasneh24@eng.just.edu.jo`, Saeed `salloubani@cybercorrelate.com`); redirect URL `https://karasneh-research.org/admin/callback` set. `admins` rows seeded with ids RECONCILED to match the real auth UIDs (the migration-seeded ids didn't match prod auth UIDs — fixed by updating `admins.id`; required clearing this-session smoke `audit_log` rows to release an FK).
- **Magic-link auth:** switched from the default `?code=` PKCE flow to `token_hash` + `verifyOtp` (commit 773e4fe). The `?code=` code-verifier cookie did not survive in production; the `token_hash` flow is now the LIVE auth path. Email template (Magic Link / OTP) sends `{{ .SiteURL }}/admin/callback?token_hash={{ .TokenHash }}&type=email`; callback route verifies via `verifyOtp`. RUNBOOK documented this as a fallback — it is now the applied path.
- **From-address swap DONE** (commit d846915): both `lib/email/invitation.ts` + `lib/email/submission.ts` send from `noreply@karasneh-research.org` (verified domain), `REPLY_TO = sjkarasneh24@eng.just.edu.jo`.
- **Production smoke PROVEN:** invitation created in live admin → email delivered to a real external inbox FROM `noreply@karasneh-research.org` (DKIM signed-by + SPF mailed-by both authenticated, landed in inbox) → token link → consent → questionnaire → submit → appeared in admin Responses + Overview → submission-notification email also delivered. Smoke data then cleaned to true-empty (incl. `audit_log`).

### Remaining before real participants (the go-live sequence — do as one linked gate)

1. **BACKUPS — ✓ v1 SHIPPED + restore-PROVEN (2026-05-24, commit 8a4c69b).** Manual encrypted DB backup (`npm run backup` → encrypted `.yarmoukbackup`); round-trip proven against a throwaway `postgres:17` (all 17 public tables count-match live); RUNBOOK "Backup & restore" documents the procedure + three-secrets pairing. Go-live readiness met. Follow-on caveats (NOT blocking): manual / no schedule (D27 deferred), DB-only (no Storage/audio), full project-level DR documented-but-not-rehearsed, and each backup must be copied OFFSITE. See "## What's Left" Tier 1.
2. **SAEED-REMOVAL** — remove `salloubani@cybercorrelate.com` from `admins` before real data goes in (see reconciled note below). Account stays during dev only.
3. **ETHICS/CONSENT** — no consent-language change needed under Sura's decision (single researcher at real-enrollment). The consent form's "accessible only to the researcher" (singular, feminine الباحثة, section 3) stays true PROVIDED Saeed-removal (item 2) happens before any real data. So item 2 is not just cleanup — it's the ethics gate. Verify it's done before response #1.

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

### The embed trap: redaction is at the VIEW layer, so never PostgREST-embed a PII base table (Session 3c-i)

Session 3c-i: PII redaction lives at the *view* layer (`*_redacted` with `security_invoker = true`), and readonly admins retain a real base-table SELECT policy on the PII tables (`invitations_readonly_select`, `consent_records_readonly_select`, `recordings_readonly_select`) — that policy is precisely what lets a `security_invoker` view return any rows. The trap: a PostgREST embed onto a PII base table (e.g. `responses.select("*, invitations(ref_code, …)")`) resolves the relationship against the **base** `invitations` table, not `invitations_redacted` — so a readonly admin gets back the **ciphertext** `recipient_*_encrypted` columns, bypassing the redacted view entirely. Rule: PII context (invitation/consent identity) is ALWAYS fetched through the role-routed repos (`lib/repos/{invitations,consent}.ts`) and joined **in memory** by id — never an embed. Same lesson family as the other "the obvious shortcut quietly defeats a security boundary" notes (D38 qualifier, 42P13 return-type, service_role grant): the convenient path and the safe path diverge, and only the safe path routes through `current_admin_role()`.

### Owner-only tables need an owner-only RLS SELECT — a redacted view doesn't cover them (Session 3c-ii)

Session 3c-ii: a redacted-view strategy doesn't cover owner-ONLY tables. `researcher_notes` had a both-roles SELECT policy (`rn_admins_select`, from migration 004) that leaked note bodies to readonly supervisors via direct PostgREST despite the UI hiding the section — found by reading live `pg_policies`, not the migration source. Owner-only surfaces need an owner-only RLS SELECT policy (migration 016's `rn_owner_select`), verified with a readonly-vs-owner contrast **under `SET ROLE authenticated`** (RLS enforced, JWT email claim set so `current_admin_role()` resolves per-admin) — NOT as postgres/service-role, which bypasses RLS and would have shown the row in both cases, masking the bug. The distinction matters in the app too: redaction (identity fields shown-or-masked, null-driven, both roles render the page) is a different mechanism from an owner-only *feature* (researcher_notes — absent for readonly, gated by `if (role === 'owner')` + action gate + RLS). Same lesson family as the embed trap and the SQLSTATE / 42P13 / service_role-grant notes: a convenient assumption (UI hides it / a view masks it) quietly defeats a security boundary; the live DB under the real role is authoritative.

### Methodological invariants belong as DB triggers, not app convention (Session 3 — question editor)

Methodological invariants (like the D10 question-freeze) that protect research validity belong as DB triggers, not app convention — a BEFORE trigger fires regardless of connection role (editor, direct PostgREST, privileged console, future script), so nothing can bypass it. The `questions_draft_only` trigger (migration 017) makes "no editing frozen questions" structural: an edited-after-answer question silently corrupts the analysis, so leaving the freeze to app good-behavior was the same shape of gap as the researcher_notes RLS leak. Verified with a transactional refusal probe (UPDATE + DELETE on an active-version question both → `check_violation` 23514, active 18 unchanged). Same family as the embed-trap / researcher_notes-RLS notes: enforce load-bearing invariants at the layer nothing can route around.
