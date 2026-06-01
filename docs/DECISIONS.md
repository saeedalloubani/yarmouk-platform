# Design Decisions

This document records *why* we made the calls we did. If something seems wrong, check here before changing it — it probably isn't a bug, it's a deliberate trade-off.

## Identity & Access

### D1. Respondents have no accounts; access via single-use tokens

**Decision:** Each invitee receives a unique URL token (`/r/{token}`). No signup, no password.

**Why:** Researchers in the target audience won't tolerate friction. Passwords are also a confidentiality risk (one leak exposes who participated). Tokens give us tracking, expiry, and revocation without identity friction.

**Implication:** We trust the email channel to deliver the token to the right person. Owner can revoke or rotate a token anytime.

### D2. Magic-link auth for admins (no passwords)

**Decision:** Admins sign in by entering their email and clicking a one-time link.

**Why:** Three admins total. Passwords add support burden, recovery friction, and breach risk. Magic links are simple, secure, and require no UX for "forgot password."

**Trade-off:** If admin email is compromised, attacker has full access. We accept this because (a) admins are senior academics likely to have institutional 2FA on email, (b) failed-login auditing catches anomalies, (c) Owner can revoke at any time.

### D3. Two roles only: Owner and Read-only

**Decision:** No "Editor" or "Reviewer" middle tier.

**Why:** The team is 3 people. More roles = more permission logic = more bugs. Sura is the sole researcher; supervisors review without modifying.

**Trade-off:** If Sura ever needs another full Owner, we add one. The role enum allows for extension.

### D4. Anonymization is enforced at the database, not just the UI

**Decision:** Read-only admins literally cannot read encrypted name/email columns via RLS — even if a UI bug tried to show them.

**Why:** Defence in depth. UI bugs happen. Database-level enforcement means a leak requires both an RLS bypass *and* a UI bug.

**Implication:** Use SQL views to expose redacted versions of tables to Read-only admins. Slightly more schema complexity, but worth it.

## Data & Schema

### D5. Pseudonymous reference codes, not UUIDs, in the admin UI

**Decision:** Display `OFF-J-04` everywhere, not `f8a92e1c-…`.

**Why:** Codes are scannable by humans. They encode category and nationality at a glance, so when reviewing responses Sura can tell who's who without needing to look up identity. Pattern is `{CAT}-{NAT?}-{SEQ}` (see `CONVENTIONS.md`).

### D6. Encrypt name/email at the column level, not whole-row

**Decision:** Only PII fields encrypted; other invitation/response data is plaintext.

**Why:** Whole-row encryption breaks indexing and query performance. Column encryption with pgcrypto + Vault-stored key meets the threat model — anonymized analytics work fast, decryption only happens when Owner explicitly views names.

### D7. Generated word_count column

**Decision:** `word_count` on `answers` is a stored generated column (computed from `answer_text`).

**Why:** Word counts are queried constantly (dashboards, stats). Computing in SQL avoids re-counting on read. Storage cost is negligible vs query speedup.

## Questionnaires

### D8. 7 variants (2 pilot + 5 main), not "one questionnaire with conditions"

**Decision:** Each respondent category gets its own questionnaire entity. Officials further splits by nationality at the Main stage.

**Why:** Originally tried "one questionnaire with category-based question visibility." Got messy fast: hard to version, hard to edit per-category wording, hard to show different sets of feedback questions. Treating each variant as a first-class entity with its own version history is cleaner.

**Trade-off:** A bit of duplication when categories share questions. Worth it.

### D9. Pilot has a built-in F1–F4 feedback block; Main does not

**Decision:** Pilot questionnaires include 4 meta-questions at the end about clarity, length, missing topics, time taken.

**Why:** Validates the instrument before full data collection. The Pilot Feedback Hub aggregates these into a "Plan V2" workflow that suggests revisions.

**Implication:** `questionnaire_versions.includes_feedback_block` flag controls rendering.

### D10. Strict version freezing on first response

**Decision:** Once any response is submitted against an active version, direct question editing is blocked. The only way forward is "Publish V2".

**Why:** Methodological defensibility. Ethics committees and thesis defenses will (rightly) ask whether a question was silently edited mid-study. Hard "no" is the only defensible answer.

**Edit windows:**
- `status = draft` → fully editable
- `status = active` AND zero submitted responses → editable (oops window)
- `status = active` AND any submitted response → frozen; clone to V2 to change

### D11. Publishing V2 atomically migrates non-submitted invitees

**Decision:** On publish: close V1, activate V2, regenerate fresh V2 tokens for invitations whose status ≠ submitted, send V2 migration emails.

**Why:** Forces a single canonical version per variant at any time. Prevents mixing V1 and V2 data in the same analytical bucket.

**Implication:** Anyone in the middle of filling V1 loses their progress. This is acceptable because pilot V1→V2 transitions are infrequent and well-signposted; the migration email tells them what happened.

## Questionnaire Behavior

### D12. Required-answer validation: cannot skip

**Decision:** "Next" disabled until current answer has ≥2 trimmed characters. Question map locks questions beyond `furthestReachable`.

**Why:** Originally the questionnaire let respondents skip. Sura tested it and found empty submissions. Required-answer enforcement protects data quality. If a respondent truly has nothing to say, they're prompted to write "N/A" or a brief note — this is intentional friction that produces better data.

### D13. Autosave on every keystroke (debounced)

**Decision:** Every answer is upserted server-side ~600ms after the user stops typing.

**Why:** 35–50 minute questionnaires. People close laptops. People lose wifi. Server-side autosave + token-based resumption means they can come back tomorrow and pick up where they left off.

### D14. Language picker on first screen; persists in localStorage

**Decision:** No auto-detect. Show picker on landing, save choice for that browser.

**Why:** Auto-detect for EN/AR is unreliable. Asking is one click. Persisting means switching is rare.

## Recordings & Transcripts

### D15. Audio is storage only; the *transcript* is the data

**Decision:** Audio files are stored encrypted, Owner-only, never exported. The *published anonymized transcript* counts toward stats and ATLAS.ti export.

**Why:** Audio is unanalyzable in a thesis context — you can't code an mp3. The published transcript is the analytical artifact. Audio is kept for verification only.

**Trade-off:** Two-step process (transcribe → anonymize → publish) before transcript data enters the dataset. Slight friction, but methodologically necessary.

### D16. Anonymization happens *before* publication

**Decision:** Transcript pipeline: `audio_only → transcribing → transcribed → anonymizing → published`. Only `published` transcripts count.

**Why:** Real names, places, identifying details are common in interview transcripts. They must be replaced with tokens (`[PERSON_1]`, `[ORG_1]`) before the transcript enters analytics or exports. The substitution key is kept Owner-only.

### D17. Bulk import supports both Q-by-Q answers and free-form transcripts

**Decision:** Excel template has both `Q1`…`Q14` columns and a `transcript_full` column. Rows can use either, both, or neither.

**Why:** Some interviews were transcribed externally (Word doc). Some have clean Q&A structure. Both must be importable. Each goes to ATLAS.ti as a separate document linked by ref_code.

## ATLAS.ti Integration

### D18. Use ATLAS.ti's Survey Import format (`.xlsx`), not REFI-QDA, as primary export

**Decision:** Featured "Export to ATLAS.ti" generates a Survey-Import-formatted `.xlsx`. REFI-QDA is offered as a secondary "advanced" option.

**Why:** Survey Import is simpler, well-documented, and gives instant value — one row per respondent becomes one document with pre-applied codes and document groups. REFI-QDA is more flexible but more complex; offer it but don't push it.

### D19. Tags applied in the platform become starter codes in ATLAS.ti

**Decision:** When exporting, applied tags map to ATLAS.ti codes via `:code:tag:tag_name` columns.

**Why:** Lets Sura do lightweight provisional tagging in the platform without committing to a final coding scheme. ATLAS.ti is where formal coding happens; platform tags are hints.

### D20. Audio files are NOT exported to ATLAS.ti

**Decision:** Only published anonymized transcripts go in the export.

**Why:** ATLAS.ti can handle audio, but our anonymization controls don't apply to it. Including audio would leak identifying voice. The text transcript is sufficient for analysis.

## Communications

### D21. Resend for email, not Postmark or custom SMTP

**Decision:** Use Resend.

**Why:** Generous free tier (~3,000/mo, plenty for a thesis), clean DX, good deliverability. Postmark is comparable but paid-only. Custom SMTP is fragile.

### D22. BCC owner toggle per template + global override

**Decision:** Each email template has its own `bcc_owner` flag; a global setting can force BCC on everything.

**Why:** Sura wants audit copies of invitations and thank-yous, but not necessarily of every reminder. Per-template control gives flexibility; global toggle is the emergency "I want to see everything" switch.

### D23. Notifications: in-app bell + email, separately toggleable

**Decision:** 6 events × 2 channels = 12 toggles per admin.

**Why:** Notification fatigue is real. Some events warrant email (new submission, security alert). Others are just in-app (invitation opened). Default sensible, let users tune.

## Security & Auditing

### D24. Audit log retained 2 years; older events archived

**Decision:** Match the response retention period (also 2 years from thesis defense).

**Why:** Symmetric retention is simpler legally and operationally. If responses are gone, the audit trail of who viewed them is less useful.

### D25. Security Log is Owner-only, hidden from Read-only

**Decision:** The Security Log page literally doesn't appear in the Read-only sidebar. Middleware enforces 403 if a Read-only admin tries to access `/admin/security` directly.

**Why:** The log contains failed login attempts (IPs, countries) and patterns that could be used to game the system. Supervisors don't need it for thesis review.

### D26. IP + geo + device captured for every admin action

**Decision:** Every audit log entry includes IP, resolved country/city via MaxMind GeoLite2, and parsed user agent.

**Why:** Anomaly detection. If "Sura" suddenly logs in from a country she's never been to, the alert is obvious. Free MaxMind dataset is good enough — we don't need IP precision, just country-level signal.

**Status (2026-05-24): partially implemented.** Phases ①+② shipped + prod-verified (commit `77b00fc`): IP + user-agent captured on every audited action; `admin.login` (success, authenticated) + `admin.login.failed` (no-session, service-role write, actor=`system`) events at the magic-link callback; `/admin/security` viewer surfaces IP. DEFERRED to end-of-project: ③ country/city geo resolution (MaxMind GeoLite2, resolve-on-read — needs a MaxMind account + license key) and ④ unknown-email-request failure logging (needs a login-page Server Action refactor; Supabase dashboard auth logs cover it meanwhile). Hardening done alongside: `log_audit` EXECUTE revoked from `anon`/`service_role` (authenticated-only). Full detail in docs/STATUS.md "What's Left".

## Operations

### D27. Daily automated backups, 30-day retention, with pinning

**Decision:** Schedule a daily backup at 03:00 UTC. Keep 30 days. Allow Owner to pin specific backups indefinitely.

**Why:** 30 days covers most "oh no I deleted something" scenarios. Pinning protects critical milestones (before V2 publish, before thesis submission). Owner can also generate manual backups anytime.

### D28. Backup format is one encrypted file (`.yarmoukbackup`)

**Decision:** Backup = ZIP archive of (a) Postgres dump as JSON, (b) audio files, (c) generated reports, (d) audit log. Encrypted at rest with a key derived from Owner's passphrase.

**Why:** Single file is easy to email, store on a USB, copy to Dropbox. Encryption means it can be transported safely.

**Trade-off:** If Owner forgets the passphrase, the backup is unrecoverable. Documentation warns clearly; encourage writing it down somewhere safe.

### D29. Vercel + Supabase free tiers chosen deliberately

**Decision:** Stay within free tiers for the duration of the thesis.

**Why:** Thesis project. No revenue. Free tiers cover: Vercel hosting + analytics, Supabase 500MB DB + 1GB Storage + 50k MAU auth, Resend 3k emails/mo. We'll watch usage; if a tier gets close, decide then.

## Architecture (Session 1)

### D30. Language: cookie-based, with token-entry fallback

**Decision:** A `lang` cookie carries the user's language. A server helper reads it; pages stay Server Components. When a respondent enters via `/r/{token}`, the route handler reads `invitations.preferred_language` and sets the cookie before redirecting to `/`. The landing-page language switcher is the only client component in the public flow.

**Why:** The mock's React-context approach forced `"use client"` on every page that touched language — which is every page. That would have violated the Server-Components-by-default convention from day one. A cookie can be read from Server Components, set from a small client switcher, and seeded from invitation data, all without making pages client-rendered.

**Implication:** `LanguageProvider` from the mock is not ported. Replace with a `getLang()` server helper plus a `<LanguageSwitcher />` client island.

### D31. PII tables accessed only via `lib/repos/*` helpers

**Decision:** Reads of `invitations`, `recordings`, and `consent_records` go through repo functions that pick the base table or its redacted view based on `current_admin_role()`. Pages and Server Actions never call `supabase.from()` directly on these tables.

**Why:** Defence in depth on top of RLS. RLS protects rows but column-level redaction relies on views; if a developer reaches for the base table directly, they bypass the view and Read-only admins could see encrypted PII columns. The repo layer makes the role-aware choice automatic.

**Trade-off:** One extra indirection. Worth it — D4 (DB-enforced anonymization) is methodologically load-bearing.

**Implication:** Non-PII tables (`questions`, `tags`, `settings`, etc.) may call Supabase directly. Full list in `CONVENTIONS.md` under "Data Access (Repos) — PII Tables".

### D32. Nationality-conditional questions use `visible_nationalities`, not parallel variants

**Decision:** A `nationality_type[]` column on `questions` (`visible_nationalities`) gates question visibility per respondent nationality. NULL or empty array = visible to everyone. A separate `pilot_officials_syrian` variant is **not** created.

**Why:** The mock's Officials pilot mixes shared questions (Q1–Q9, Q14) with Syria-only ones (Q10–Q13). Splitting into two parallel variants would duplicate the shared questions, make wording drift inevitable, and complicate cross-nationality analysis. Per-question gating keeps a single source of truth.

**Trade-off:** The questionnaire engine has to filter questions at render and validation time based on `invitations.nationality`. A small amount of extra logic, far less than maintaining two parallel variants in sync.

**Type choice:** `nationality_type[]` (enum array), not `TEXT[]`. The respondent population is fixed by methodology; type safety prevents silent analysis bugs from typos. If the nationality set ever needs to grow, the enum is altered via migration — that's the moment we want the type system to surface every call site.

### D33. Self-hosted fonts via `next/font/google`, not `@import url(...)` in CSS

**Decision:** Plus Jakarta Sans, IBM Plex Sans Arabic, and JetBrains Mono are loaded through `next/font/google` in `app/layout.tsx`, exposed as CSS variables (`--font-sans`, `--font-arabic`, `--font-mono`), and referenced from `tailwind.config.ts`. The mock's `@import url('https://fonts.googleapis.com/...')` in `globals.css` is not ported.

**Why:**
- **Privacy.** No runtime third-party fetch to `fonts.googleapis.com` — respondents include officials whose IP exposure to Google is not something we want to introduce. Self-hosting eliminates that channel.
- **Performance.** Fonts are bundled at build time and served from the same origin, eliminating the FOUT/FOIT flash on first paint. Next handles `font-display: swap` and preload hints automatically.
- **Build-time guarantees.** `next/font` fails the build if a font file can't be fetched, so we find out at deploy time, not on a respondent's first visit.

**Implication:** Tailwind's `fontFamily` config uses `var(--font-sans)` etc., not literal font names. Adding a new font means adding it to `app/layout.tsx` *and* exposing a CSS variable — there's no shortcut via `globals.css`.

### D34. Pin to Next 15, not Next 16

**Decision:** `package.json` pins `next@15.5.18`. We do not adopt Next 16 during the thesis.

**Why:**
- `CLAUDE.md` prescribes Next 15. Honouring the project's own constraint matters more than chasing the latest release.
- Next 16 (released alongside our scaffolding) carries breaking changes around caching defaults and async request APIs. A mid-thesis migration introduces risk for no immediate benefit — none of our planned features need Next 16 primitives.
- The thesis defence depends on a stable platform from now through submission. "We upgraded the framework two weeks before defence and something broke" is a story we explicitly do not want to tell.

**Revisit:** After Session 7 (post-launch, post-data-collection). If a Next 16 LTS exists by then and the migration is straightforward, do it. Otherwise stay on 15 until the thesis is filed.

### D35. Tailwind v3, not v4

**Decision:** `package.json` pins `tailwindcss@^3.4.15` with the classic `tailwind.config.ts` + `postcss.config.js` setup. The v4 default from `create-next-app` was explicitly downgraded.

**Why:** The mock's design system — every `brand-*`, `accent-*`, `ink`, `muted` token, plus the custom font-family wiring — was authored for v3's `theme.extend` config schema. v4 replaces this with a CSS-first `@theme` directive that would require rewriting every token mapping and re-validating the entire palette. The visual output would be identical; the cost is pure migration with zero user-visible benefit.

**Trade-off:** v3 is in maintenance mode. Bug fixes still ship but no new features will. For a closed-population study running for ~12 months, this is acceptable — we don't need the v4 features (container queries via `@container`, native CSS cascade layers, etc.) for any planned work.

**Revisit:** If v3 stops receiving security patches, or if a v4 feature becomes necessary, plan the migration as a dedicated session. Don't fold it into other work.

### D36. pgcrypto encryption key lives in Supabase Vault

**Decision:** The pgcrypto key used to encrypt PII columns (`recipient_name_encrypted`, `recipient_email_encrypted`, `signed_name_encrypted`) is stored in `vault.secrets`, accessed only via `vault.decrypted_secrets` from inside SECURITY DEFINER SQL functions. Application code never sees the key. The `.env` variable `ENCRYPTION_KEY` is retained only as a local-dev fallback and is removed before production cutover.

**Why:**
- Vault is purpose-built for this — `vault.decrypted_secrets` is a view that holds plaintext keys only at query time, in memory, never on disk in plaintext.
- Keeping the key out of application memory means a Node-side compromise (RCE, dependency hijack, debugger attached to the running process) doesn't expose it.
- All decrypt paths flow through one bottleneck (the SQL helper), which makes audit-logging access trivial and key-rotation tractable.

**Pattern:** Session 2b will add two SECURITY DEFINER helpers:
- `encrypt_pii(plaintext TEXT) RETURNS TEXT` — reads the current key from `vault.decrypted_secrets`, returns ciphertext via `pgp_sym_encrypt`.
- `decrypt_pii(ciphertext TEXT) RETURNS TEXT` — tries the current key first, then falls back to the previous key on failure (supports rotation; details below).

Application code calls these via `supabase.rpc(...)`. One RPC round-trip per PII encrypt/decrypt — acceptable given the very low volume of PII reads (Owner viewing a name a handful of times per session).

**Key rotation:** Keys are stored as versioned secrets in Vault — e.g., `pii_key_v1`, `pii_key_v2`. `decrypt_pii` tries the highest version first; on `pgp_sym_decrypt` failure (ciphertext was encrypted under an older key), it retries with the previous version. Rotation procedure:
1. Generate new key, write to Vault as `pii_key_v(N+1)`.
2. New writes use `v(N+1)`; old reads still succeed via fallback.
3. Optional: backfill re-encrypt old rows under the new key, then delete `pii_key_v(N-1)` from Vault.

**Trade-off:** RPC overhead vs. caching the key in app memory. For our PII volume the overhead is negligible; the security gain (key never crosses the DB→app boundary) outweighs it.

### D37. Email is the admin identifier in role-resolution helpers

**Decision:** `current_admin_role()` and `current_admin_id()` look up `admins` by `email = auth.jwt() ->> 'email'`. We commit to email-as-identifier rather than adding `admins.auth_user_id UUID REFERENCES auth.users(id)` and looking up via `auth.uid()`.

**Why:**
- 3 admins total, no SSO planned. Email is the canonical identifier everywhere — invitations, Resend, the magic-link flow.
- `auth.uid()` is more abstract; using it would require a separate `admins.auth_user_id` column wired during magic-link first-login. More moving parts for marginal benefit at this scale.
- The email claim is reliably present in Supabase magic-link JWTs.

**Trade-off / change procedure:** If an admin ever needs to change their email, both `admins.email` and the Supabase Auth user record must be updated together. This is a coordinated 2-step operation. For 3 admins with stable institutional emails, the expected frequency is approximately zero; if it happens, it's a one-time owner-run script.

**Revisit if:** We add SSO, expand the admin set beyond ~10 people, or observe email-change requests in practice. At that point the cost of adding `auth_user_id` is small compared to the operational pain of email-based lookup at scale.

### D38. Pgcrypto (and other extension) functions are always called with the `extensions.` schema qualifier

**Decision:** Any call to a pgcrypto function (`digest`, `pgp_sym_encrypt`, `pgp_sym_decrypt`, `hmac`, `gen_salt`, `crypt`, etc.) in our SQL is qualified with `extensions.`. No reliance on `search_path` to find them.

**Why:** Supabase installs pgcrypto in the `extensions` schema, not `public`. Our SECURITY DEFINER functions pin `search_path = public, pg_temp` for security — `extensions` is intentionally not on that path. Unqualified calls fail at execution, and PL/pgSQL won't surface the error at CREATE TIME because function bodies are compiled lazily (parse-time checks names + arity, not symbol resolution).

**Caught the hard way:** Migration `20260519170003_functions.sql` shipped `digest(p_token, 'sha256')` unqualified; the function created fine, the bug surfaced on first invocation. Fix in `20260519170008_fix_pgcrypto_qualification.sql`.

**Not affected:** `gen_random_uuid()` is a `pg_catalog` built-in in PG 13+, which precedes `search_path` implicitly. Our UUID PK DEFAULTs work without qualification.

**Convention:**

1. **In SQL code.** Always qualify extension functions with their schema: `extensions.digest`, `extensions.pgp_sym_encrypt`, etc. Never rely on `search_path` for resolution.

2. **In migration review.** Before any migration that touches crypto, grep migration files for unqualified pgcrypto names. Empty output = clean. Any hits = qualify before applying. Same command used in 0008's audit:

   ```
   grep -nE '\b(digest|pgp_sym_(encrypt|decrypt)|crypt|gen_salt|hmac)\b' \
     supabase/migrations/*.sql \
     | grep -v 'extensions\.' \
     | grep -vE '^[^:]+:[0-9]+:[[:space:]]*--'
   ```

   The third pipe excludes SQL line-comments (`-- ...`); without it the grep reports comment mentions of pgcrypto function names as false positives (e.g., header comments documenting a prior fix).

   Extend the alternation when adding calls to other pgcrypto functions (`armor`, `dearmor`, `pgp_pub_encrypt`, `encrypt_iv`, etc.). The point is the grep is part of the review checklist for any crypto-touching migration — not a one-time audit.

### D39. SECURITY DEFINER functions that read from tables must alias every reference and qualify every column

**Decision:** In every SECURITY DEFINER PL/pgSQL function that reads from tables, every table reference gets an alias (`invitations AS i`, `responses AS r`) and every column reference inside `SELECT` / `WHERE` / `UPDATE` / `RETURNING` uses that alias. No exceptions. No `#variable_conflict use_column` pragma.

**Why:** PL/pgSQL turns every `RETURNS TABLE (...)` column name into an implicit OUT parameter visible inside the function body. When an OUT parameter shares a name with a real column on a table the function queries (`id`, `expires_at`, `category`, `status`, etc. — likely most of them), bare references are ambiguous and Postgres errors at execution.

**Caught the hard way:** The same `validate_invitation_token` that needed `extensions.digest` qualification in 0008 also has 7 OUT parameters from its `RETURNS TABLE`. Bare `expires_at` and `id` references inside the body collided with the same-named columns on `invitations`. Lazy compile hid this through CREATE FUNCTION; surfaced at first call. Fix in `20260519170009_alias_validate_token_columns.sql`.

**Why not `#variable_conflict use_column`:** It silently prefers column over variable, which means a future variable that happens to share a column name is silently shadowed and the function behaves wrong instead of erroring. Implicit resolution is the wrong tool when correctness is load-bearing.

**Why not renaming OUT params (`out_id`, `out_expires_at`):** It pollutes the function's public API. `database.types.ts`, the repos, and any RPC consumer would all need to read `out_id` instead of `id`. Worse for downstream code than a verbose internal convention.

**Convention:**

1. **In SQL code.** Inside any SECURITY DEFINER function body that reads from tables, every table reference is aliased and every column is qualified. The RETURN QUERY SELECT source side can stay unqualified when sourcing from a record variable (`v_inv.id`, `v_resp.id`) — that's already unambiguous. The destination side (OUT params by position) doesn't need qualification.

2. **In migration review.** Before any migration that adds or modifies a function with `RETURNS TABLE`, grep:

   ```
   grep -nE 'RETURNS TABLE' supabase/migrations/*.sql
   ```

   Then for each match, read the function body and verify every `SELECT` / `UPDATE` / `RETURNING` uses table aliases on every table-column reference. Add this to the same review checklist as D38's pgcrypto grep — both are "after CREATE, before considering applied" checks.

### D40. Compound questions are coded as separate units in ATLAS.ti

**Decision:** Compound questions in any questionnaire variant (currently Q2 "decline causes + impacts" and Q4 "absence's effect + future provisions" in Pilot V1 Officials; future variants may add more) get separate coding passes in ATLAS.ti. Each sub-question is its own coding unit; the full answer text is not treated as monolithic.

**Why:** Respondents to compound questions frequently answer one half and skip the other. Coding the full response as a single unit collapses two analytical dimensions into one and loses methodological resolution. Coding separately preserves the signal — including the signal that "Q2 had a higher response rate on causes than on impacts," which is itself a finding worth reporting.

**Applies to:** Any compound question across all variants. Identifiable by multiple question marks within a single Q-text, or "and" / em-dash connectors separating distinct asks. When a new variant adds compound questions, the same convention applies — no per-variant re-derivation.

**Implication:** ATLAS.ti document group / code naming reflects this. For Q2, two codes: `Q2a_decline_causes` and `Q2b_decline_impact`. Coding workflow documented in the Session 4 ATLAS.ti export pipeline.

**Methodological grounding:** Compound questions are called "double-barrelled" in survey methodology literature (Bradburn et al., *Asking Questions*, 2004). The recommendation to either split them pre-fielding *or* code their answers separately post-fielding is established practice. Pilot V1 ships with compound Q2/Q4 intentionally — F1-F3 feedback will tell us whether respondents found them confusing enough to split for V2.

### D41. Respondent session cookie is unsigned; DB validation is the integrity check

**Decision:** The `yarmouk_session` cookie carries the raw `response_id` UUID (and nothing else) as an unsigned, opaque value. There is no HMAC, no JWE, no signing secret. On every server-side read, a single helper (`getSession()` in `lib/cookies.ts`) joins `responses` to `invitations` and rejects the session if the row is missing, locked, submitted, or attached to an expired invitation.

**Why:** The only thing an attacker could forge in the cookie is the `response_id`, which is a UUIDv4 with 122 bits of entropy. Computationally infeasible to guess. Signing adds machinery that defends a vector that doesn't exist for this payload, while creating real costs: a new env var (`SESSION_COOKIE_SECRET`), a rotation procedure to document, and a crypto round-trip on every request.

**Threat model in plain terms:**

- **Cookie tampering:** a respondent edits their own `response_id` to point at someone else's response. They'd need to guess a 122-bit UUID. Infeasible.
- **Cookie theft:** someone gets a copy of the cookie. The cookie is `httpOnly` + `Secure` + `SameSite=Lax`, so theft requires either physical access to the device or a successful XSS exploit. This threat is identical with or without signing — signing protects against forgery, not theft.
- **Server-side bug:** the cookie validates but we serve the wrong data. The DB hydration in `getSession()` is the actual check — signing wouldn't help here.

**Implication:** No `SESSION_COOKIE_SECRET` env var. `getSession()` does one DB read per request (small, well-indexed). If we ever identify a real signing threat — e.g., we start storing cookie payloads that aren't pure DB lookups — revisit this decision and add signing then. Do not pre-emptively add signing "just in case."

**Not relitigated when:** considering `jose`, `iron-session`, or roll-your-own HMAC. The point isn't the library; it's that signing defends nothing here.

### D42. Response row is created inside `validate_invitation_token`, not by the caller

**Decision:** On a fresh-claim hit to `/r/[token]`, the `responses` row is INSERTed inside the `validate_invitation_token` SECURITY DEFINER function, in the same transaction as the use_count increment and status transition. The function returns the new `response_id` on both fresh-claim and resumption paths. The route handler never INSERTs into `responses`.

**Why:** Atomicity. The alternative — caller does the INSERT after RPC — has two failure modes the atomic version doesn't: (a) the validate RPC succeeds and increments `use_count`, but the follow-up INSERT fails (race with delete, transient DB error, RLS misconfiguration), leaving an invitation marked "opened" with no response and a respondent who sees an error page; (b) the route handler crashes between RPC and INSERT, same outcome. Putting both into one SECURITY DEFINER body collapses these to a single transaction. Either both happen or neither does.

**Side benefit — RLS:** the `responses` table only permits INSERT for the owner role (`r_owner_insert`). The anonymous route handler couldn't INSERT directly even if we wanted it to; SECURITY DEFINER inside the function bypasses RLS legitimately. We could have added an `r_anon_insert` policy with some conditional check, but the policy logic would have to re-prove what the function already proves (valid token, not exhausted, not submitted). Keeping the INSERT inside the function avoids duplicating that logic in two places.

**Implication:** Migration 012 extends `validate_invitation_token`'s `RETURNS TABLE` with `response_id UUID` (non-null on every non-empty return) and `ref_code TEXT`. The route handler becomes a single RPC + cookie write + redirect. Cleanup of orphaned responses (if a respondent enters but never answers) is trivial via a future cron — `started_at < NOW() - interval 'N days' AND submitted_at IS NULL AND NOT EXISTS (SELECT 1 FROM answers WHERE response_id = r.id)` — deferred until pilot data shows whether it's needed.

**Caught the design hole:** Initially the response row was going to be created in the route handler. The RLS issue surfaced during Session 2b-2 scoping. Easier to design atomically than to retrofit.

### D43. Language resolution order: invitation overrides on entry; cookie everywhere else; Accept-Language ignored

**Decision:** The respondent's display language is resolved in this priority order:

1. **On `/r/[token]` entry:** `invitations.preferred_language` is written to the `yarmouk_lang` cookie, overriding any existing cookie value. The invitation wins on entry, every time.
2. **Everywhere else (landing, consent, questionnaire, submitted):** the `yarmouk_lang` cookie is the source of truth. The respondent can change it via the LanguageSwitcher component, which updates the cookie + triggers a server-side re-render.
3. **`Accept-Language` header:** ignored entirely. Never consulted.

**Why invitation wins on entry:** `invitations.preferred_language` is the most intentional signal in the system. Sura sets it deliberately per recipient (an Arabic-first official gets `'ar'`; a researcher who corresponds in English gets `'en'`). The recipient may have a cookie left over from a previous visit in the other language — typically because they clicked a friend's link, or were testing. The invitation's language carries Sura's research intent and should not be silently overridden by stale browser state.

**Why the cookie thereafter:** once the respondent has chosen (implicitly, by accepting the invitation default, or explicitly, by clicking the switcher), that choice should persist across page navigations and through the autosave/resume flow. localStorage was the original plan (D14) but cookies (D30) win: server components can read them without JS, RTL `dir` attribute renders correctly on first paint, and there's no flash-of-wrong-language.

**Why not `Accept-Language`:** noisy, often wrong, and easy to spoof. A respondent's browser locale tells us almost nothing about which language they want to *answer in*. Many bilingual respondents have an English browser but answer in Arabic. Inferring from the browser would override the carefully-chosen invitation language for no good reason.

**Implication:** The `/r/[token]` route handler always calls `setLang(row.language)` unconditionally. `getLang()` reads the cookie with `'en'` as the only fallback. The LanguageSwitcher writes the cookie + `router.refresh()`. No middleware, no header sniffing.

**Known trade-off:** if a respondent switches language mid-flow via the LanguageSwitcher, then closes the browser and re-enters through the email link, the lang cookie resets to the invitation's `preferred_language` (the override on `/r/[token]` entry runs on every visit, including resumption). This is intentional — the email link is the canonical reset anchor. Preserving a mid-flow language choice across resumption would create worse failure modes: a shared browser, an accidental switcher click, or a second invitation with a different `preferred_language` could leave the cookie authoritative over the invitation, producing language-chrome-vs-content mismatches (e.g., English UI wrapping Arabic answers). Verified in the 2b-2 manual smoke (test f): mid-flow switch to Arabic, re-entry via token, page correctly reset to English with no new response row and `use_count` unchanged.

### D44. Invitation token plaintext format: 32 random bytes, base64url-encoded

**Decision:** Every invitation token is generated as exactly 32 cryptographically random bytes, encoded as base64url without padding (43 characters, URL-safe, no `+`, `/`, or `=`). Stored as the SHA-256 hex digest in `invitations.token_hash`. Plaintext exists only at mint-time and in the recipient's email inbox.

**Why:** 32 bytes = 256 bits of entropy, matching the SHA-256 output size. base64url is URL-safe — survives copy/paste through email clients, mobile messaging, and URL bars without escaping. 43 chars keeps the link short enough to render cleanly in plain-text email. No padding means no trailing `=` that some email clients mangle.

**Generators MUST use this format:**

- The admin "create invitation" Server Action (Session 3)
- Any future bulk import that mints tokens
- Any backfill or migration that needs to issue tokens
- Test fixtures and seed scripts that exercise the token flow

**Generation pattern (TypeScript, for Session 3):**

```ts
import { randomBytes, createHash } from "node:crypto";
const plaintext = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(plaintext).digest("hex");
// Send plaintext in email; store only hash in invitations.token_hash.
```

**Why not stored:** plaintext is forward-only. The hash column is one-way; resend = mint new, rotate hash, old link stops working. Documented as Task #11 (TASK_STATE.md) for Session 4 admin docs.

**Not relitigated when:** considering shorter tokens for "nicer URLs." Tokens are clicked from email, never typed. 43 chars is fine. Also not relitigated when considering UUIDs as tokens — UUIDs leak generator state, have only 122 bits of entropy, and don't match the SHA-256 hash size.

### D45. `CREATE OR REPLACE FUNCTION` cannot change a function's return type — use DROP + CREATE for signature changes

**Decision:** When a migration changes the return type of an existing function — `RETURNS` scalar type swap, or `RETURNS TABLE` column addition/removal/reorder/type-change — the migration uses `DROP FUNCTION IF EXISTS <fn>(<exact-arg-types>); CREATE FUNCTION ...` rather than `CREATE OR REPLACE FUNCTION`. Body-only changes can continue to use `CREATE OR REPLACE`.

**Why:** Postgres rejects `CREATE OR REPLACE FUNCTION` with SQLSTATE 42P13 (`cannot change return type of existing function`) if the new declaration's return type differs from the existing function. This is a safety measure — silently changing the return type could break callers (cached plans, application code reading specific columns, downstream views). Postgres makes you opt in to the breaking change by explicitly dropping the function first.

**Failure mode:** `supabase db push` rejects the migration at parse time. Nothing applies. `schema_migrations` is unaffected — retry path is clean. The error is loud (SQLSTATE 42P13, "cannot change return type"), not silent.

**Convention:**

1. **In SQL code.** Identify return-type-affecting changes before writing:
   - Adding, removing, reordering, or changing the type of any `RETURNS TABLE` column
   - Changing `RETURNS x` to `RETURNS y`
   - Changing `RETURNS SETOF x` to `RETURNS SETOF y` or to `RETURNS TABLE`

   For any of these, use:

   ```sql
   DROP FUNCTION IF EXISTS public.foo(arg1_type, arg2_type, ...);

   CREATE FUNCTION public.foo(arg1_type, arg2_type, ...)
   RETURNS ...
   ...;

   -- Restate REVOKE/GRANT — DROP removes prior grants.
   REVOKE EXECUTE ON FUNCTION public.foo(...) FROM PUBLIC;
   GRANT  EXECUTE ON FUNCTION public.foo(...) TO ...;
   ```

   `IF EXISTS` keeps the migration idempotent on fresh DBs. Exact arg signature on `DROP` is required when the function is overloaded — bare name fails.

2. **Dependency check.** Before applying a DROP-then-CREATE migration on an existing function, query `pg_depend` to verify no view, trigger, or other function depends on the one being dropped:

   ```sql
   SELECT pg_describe_object(classid, objid, objsubid)
     FROM pg_depend
    WHERE refobjid = 'public.foo(arg_types)'::regprocedure;
   ```

   Empty result = safe to drop. Non-empty = the dependents will be dropped too by `CASCADE` (or refuse to drop without it), and the migration must recreate them.

3. **In migration review.** When modifying an existing function, compare the function's `RETURNS` clause against the prior migration. If it changed, the migration must be DROP-then-CREATE, not `CREATE OR REPLACE`. Add this as the third grep in the SECURITY DEFINER review checklist:

   ```
   grep -nE 'CREATE OR REPLACE FUNCTION|RETURNS TABLE' supabase/migrations/*.sql
   ```

   For each CREATE-OR-REPLACE match, verify the corresponding `RETURNS` clause is byte-identical to the latest prior definition.

**Not relitigated when:** body changes only. `CREATE OR REPLACE FUNCTION` is still the right tool for body edits, security context changes, search_path changes, grants — anything that doesn't touch the `RETURNS` clause or the argument list.

**Sibling lesson to D38, D39, and the SQLSTATE-verify pattern:** all of these are "Postgres compiles lazily and forgives a lot at CREATE time; the failure mode is execution-time or push-time, not parse-time." The defense is reviewer discipline + targeted greps + early probes, not relying on Postgres to catch our mistakes upfront.

### D46. Questionnaire is a one-question-per-page wizard; current position is derived, not stored

**Decision:** The respondent questionnaire renders one question per page (Next/Back wizard). The respondent's current position is derived on entry as the first visible question with no saved answer (empty if none) — there is no `current_position` column. If every visible question is answered, entry lands on the last question (submit available).

**Why:** Position is a pure function of saved answers; storing it would be redundant state that can drift from the answers themselves. Derivation keeps responses single-sourced (the answers table) and makes resumption automatic — a respondent who answered Q1–Q5 and left re-enters at Q6 with no bookkeeping. Consistent with the status-denormalization convention (read underlying state, don't store a convenience copy that can lag).

**Scope:** "visible" = after `visible_nationalities` filtering (D32). A Jordanian respondent's first-unanswered is computed over Q1–Q9, Q14, F1–F4 only.

### D47. Submit gate is enforced server-side over the respondent's visible required set

**Decision:** A questionnaire submission is accepted only if every REQUIRED question VISIBLE to that respondent (after `visible_nationalities` filtering) has a non-empty answer. This check runs server-side in the submit Server Action, re-reading the answers from the DB. The client-side gate (disabled submit button, per-step Next block) is UX only and is never trusted.

**Why:** The client can be bypassed (devtools, crafted Server Action calls). Data integrity for the analytical dataset depends on the server being the sole authority on "complete." Visible-set scoping means a Jordanian respondent is never blocked for the Syria-only Q10–Q13 they never saw (D32).

**Implication:** Submit re-derives the visible required set from the active version's questions + the respondent's nationality, then confirms each has a non-empty answer row, before setting `responses.submitted_at`. The "non-empty" definition is `trim(answer_text).length > 0` — character-count niceties are UX only. The `saveAnswer` path carries the inverse authority: it rejects writes to a response that is already submitted or locked, so submission is genuinely terminal.

### D48. Public respondent-flow data access uses the service-role admin client (or SECURITY DEFINER), never anon RLS

**Decision:** All database access in the public respondent flow (reading questions, reading/writing answers, writing consent, reading/updating responses) runs server-side through the service-role admin client or through SECURITY DEFINER functions. The anon Supabase client is never used for respondent data, because the schema has no anon RLS policies — every policy is `TO authenticated` and owner-gated for writes.

**Why:** Respondents have no JWT and no admin role; RLS would reject every operation. Rather than open a permissive anon RLS surface (which would have to re-prove, in policy logic, the same token/session validity the flow already establishes), the flow escalates explicitly at the server-side call site. Integrity comes from session/token validation gating WHICH `response_id` the flow may touch — not from RLS. Generalizes the 2b-2 precedents: `getSession`'s admin client (D41) and `validate_invitation_token`'s SECURITY DEFINER (D42).

**Boundary:** admin-client access is confined to Server Components and Server Actions (never a `"use client"` module; `lib/supabase/admin.ts` throws on browser import). Public-flow helpers do NOT call `getCurrentAdminRole` — that's for admin-context repos. Public-flow read/write helpers take the admin client and scope every query to the session's `response_id`. They live in `lib/repos/*` (questions, answers, plus the public-flow section of consent) so PII access stays inside the repo layer (D31) even when the caller is anonymous.

**Verified, not assumed:** 2b-3's consent flow is the first code to call `encrypt_pii` via the service-role client. A `has_function_privilege` probe (`supabase db query --linked`) confirmed `service_role` already holds EXECUTE on `encrypt_pii`/`decrypt_pii` despite migration 010's bare `GRANT … TO authenticated` — Supabase grants `service_role` broader function privileges than the migration text implies. No grant migration was needed; the probe overturned a confident static read.

### D49. Supabase Auth public signup is locked down — only pre-authorized admin emails can authenticate

**Decision:** Signups are disabled in the Supabase dashboard; the (eventually 3) admin `auth.users` identities are hand-provisioned via the dashboard; `signInWithOtp` uses `shouldCreateUser: false`.

**Why:** Open signup would be an unauthenticated email-send primitive (abuse, and it shares the rate limit with real logins), would pollute the `auth.users` audit surface of an ethics-reviewed study, and would make the app-layer `current_admin_role()` gate the SOLE barrier to data — a single point of failure. Locking signup turns any future guard bug into a non-event; the app-layer gate remains defense-in-depth, not the front door.

**Layers (four):** (1) dashboard signups disabled; (2) admin `auth.users` identities pre-created; (3) `shouldCreateUser:false` in the login call; (4) the `admins` allow-list — an authenticated identity with no matching active `admins` row resolves to role NULL → `/admin/unauthorized`. The `auth.users` allow-list is the *authentication* gate; `admins` is the *authorization* gate; they're separate lists kept aligned by hand for ~3 people.

**Revisit:** if admin count ever needs to scale beyond a hand-managed allow-list.

### D50. Admin auth architecture — middleware refresh + `(protected)` layout guard

**Decision:** `middleware.ts` runs the `@supabase/ssr` session refresh on `/admin/*` (refresh only, no redirects). `app/admin/(protected)/layout.tsx` (Server Component) owns the authorization decision tree: no session → `/admin/login`; authenticated non-admin → `/admin/unauthorized`; active admin → render. `login` / `callback` / `unauthorized` live OUTSIDE the `(protected)` route group so an unauthenticated bounce can't loop. `getCurrentAdmin` uses the authenticated server client — the service-role client has no user email claim and would resolve role NULL. Passwordless magic-link / OTP via Supabase's BUILT-IN email; Resend is reserved for respondent invitation emails (later). Login responses don't reveal whether an email is an admin (no enumeration).

**Why split middleware vs layout:** the role check needs a DB RPC and the authenticated server client; running it in the layout (Node runtime, DB access) keeps it off every edge request and gives a single source of redirect truth. Middleware's only job is token refresh so the server client sees a fresh session.

**Magic-link transport:** PKCE `?code=` exchange in `/admin/callback` is the primary path; the `token_hash` + `verifyOtp` flow (one email-template tweak) is the documented fallback if the PKCE code-verifier cookie isn't shared (see RUNBOOK.md "Admin auth bootstrap" + the callback route comment).

### D51. Admin email matching is case-insensitive (`lower()` + CHECK), addressing the 2a casing risk

**Decision:** `current_admin_role` / `current_admin_id` / `current_admin` compare `lower(email) = lower(auth.jwt() ->> 'email')`; `admins.email` carries `CHECK (email = lower(email))` to enforce lowercase storage.

**Why:** the JWT email claim's casing can't be trusted to match stored email; a silent case mismatch would deny a legitimate admin (the risk 2a flagged). `lower()` is chosen over `citext` to avoid the extension-operator/`search_path` gotcha (D38) inside SECURITY DEFINER functions — `lower()` is a `pg_catalog` builtin, always resolvable under the locked `search_path`.

**UNIQUE side-effect:** because the CHECK forces every stored email to lowercase, the existing `UNIQUE(email)` constraint becomes effectively case-insensitive — two rows can no longer differ only by case (e.g. `Sura@x` is rejected at insert; only `sura@x` is storable), so a case-variant duplicate admin can't exist.

### D52. ref_code is free-text (format-guided), with `UNIQUE` as the duplicate guard

**Decision:** The invitation `ref_code` (the pseudonymous display ID, D5 — e.g. `OFF-J-04`) is entered as free text by the owner in the create form, validated for shape (letters/digits/dashes, non-empty) but not for strict scheme-matching. The `UNIQUE(ref_code)` constraint is the duplicate guard; the create action maps `23505` → `ref_code_taken`.

**Why:** auto-generating the sequence number (`{CAT}-{NAT}-{SEQ}`) means a count query per category+nationality with a race on `SEQ` — more machinery than minting needs, and it would lock Sura into one numbering scheme. Free text lets her match her own records; the `UNIQUE` constraint makes a collision a clean, recoverable error rather than a silent dup. Auto-generation is a clean future enhancement if hand-typing becomes tedious.

### D53. The plaintext invitation token is surfaced exactly once, never stored/logged/in a URL

**Decision:** On invitation create, the plaintext token is returned by the Server Action and rendered once as the `/r/<token>` URL on the success view (3b-i) — with a "shown once, not recoverable" notice — or emailed (3b-ii). It is never persisted (only the SHA-256 `token_hash` is, per D44), never written to logs, and never placed in a page URL or query string (which would leak it into browser history).

**Why:** the token is a bearer credential granting access to a respondent's questionnaire + their encrypted PII. Minimizing its lifetime and surface area is the whole point of storing only the hash (D44). Re-issuing a link means minting a new token (resend = rotation, 3b-ii) — there is deliberately no way to recover a lost plaintext.

### D54. Admin mutations are audited via a SECURITY DEFINER `log_audit()` function

Admin mutations are audited via a SECURITY DEFINER `log_audit()` function granted to `authenticated`. It bypasses the `audit_log` RLS insert restriction while `auth.jwt()` inside still resolves the caller's email, so the `audit_log_fill_actor` trigger snapshots the ACTING OWNER (not `'system'`). `lib/audit.ts` wraps it; every admin mutation calls it before returning. This resolves the RLS-vs-trigger actor-attribution tension (service-role insert → mis-attributed `'system'`; authenticated insert → blocked by RLS).

**Pattern established in 3b-i:** the create action calls `logAudit()` AFTER the mutation commits (auditing a completed action), as a separate statement — deliberately NOT one transaction with the insert, so an audit hiccup can't roll back a minted credential. Security-relevant *refusals* are also audited: a non-owner reaching the create gate logs an `invitation.create.forbidden` `warn` row before being refused. Audit `metadata` carries non-PII context only — never the token, name, or email.

### D55. App invitation emails are sent via the Resend API directly (resend SDK)

App invitation emails go through the Resend API directly (the `resend` SDK), server-side, distinct from Supabase auth emails (magic links, which use Supabase SMTP). Invitation mail is app-triggered with app-controlled bilingual content, from/reply-to, and the `/r/<token>` link; Supabase SMTP serves only its own auth mail and exposes no general send API. `RESEND_API_KEY` is required; the helper throws if it's unset. The recipient address and token URL never appear in logs or audit metadata.

**Email copy** lives in `lib/email/invitation.ts` (a separate surface from the web i18n). EN is final; AR currently **falls back to EN** — first-contact copy with officials must be native-speaker-written by Sura. Real bilingual sends are gated behind two paired pre-launch items: Sura's Arabic copy AND Resend domain verification (the `onboarding@resend.dev` test sender only delivers to the Resend account address — confirmed live in 3b-ii smoke).

### D56. Resend = response-aware token rotation

Minting a new token overwrites `invitations.token_hash` — the old link dies immediately (irreversible, D44/D53). The reset branches on the `responses` table (source of truth, not `invitations.status`):

- **submitted response exists → BLOCK** (`already_submitted`): `validate_invitation_token` rejects re-entry on `submitted_at` regardless of token, so a new link would be dead-on-arrival. The block is enforced at the action level (before mint/rotation), not just the UI — verified live (3b-ii smoke e: token_hash frozen, no new audit row).
- **in-progress (non-submitted) response → "resume re-send"**: new `token_hash` + extend `expires_at`; KEEP `use_count`/`status`/`opened_at`. The new link resumes the existing response via validate's resumption path. Work is preserved — verified live (3b-ii smoke d: answer + use_count intact after rotation).
- **no response → "fresh re-send"**: new `token_hash` + `use_count=0` + `opened_at=NULL` + `status='sent'` + extend `expires_at`.

Resend NEVER touches `responses`/`answers`, so a respondent's work is structurally safe in every branch.

**Corollary (from D53):** the create-time token can only be emailed AT create (the plaintext exists once); "send later" necessarily mints fresh — i.e. it is a resend.

**Email-failure consequence (loud surface):** the DB rotation and the email are separate statements (per D54 ordering — you can't email a token you haven't minted+rotated). Because `token_hash` is overwritten BEFORE the email sends, a rotation that commits and then fails to email leaves the OLD link dead and the NEW link only in the action's returned `tokenUrl`. Recoverable (resend again), but the UI MUST surface the failure unmissably and show the new `tokenUrl` prominently — louder than create's email-failure surface, where no link is ever dead. (`InvitationResendButton` renders a red panel with the link on `ok && !emailed`.)

### D57. The recordings Storage bucket is dashboard-provisioned, not migration-managed

The private `recordings` bucket (50 MB per-file limit, audio-MIME allow-list, `public=false`) is created through the Supabase Studio dashboard, deliberately NOT in a SQL migration. Migration 018 manages the *access control* on the bucket's contents (`recordings_obj_owner_all` RLS on `storage.objects`) but not the bucket's existence.

**Why:** Storage buckets sit in the same category as Vault secrets (watch-out #7) — infrastructure provisioned out-of-band, not reproducible cleanly through `supabase db push`. A `storage.buckets` INSERT in a migration is fragile across environments and fights Supabase's own provisioning. The migration owns what SQL owns well (RLS policies, triggers); the dashboard owns the bucket. A fresh environment requires the documented manual step of creating the bucket — recorded in RUNBOOK / STATUS, not assumed.

**Corollary — Storage objects are API-delete-only:** `storage.objects` rows cannot be removed via SQL `DELETE` (the `storage.protect_delete` trigger raises 42501). Deletion must go through the Storage API `.remove()` (which `deleteRecordingObject` does). Any future cleanup or backup tooling must use the API, not SQL.

### D58. Recording↔consent is a database trigger, not an application convention

Audio may only be attached to a response whose consent record has `audio_consent = true`. This is enforced by the `recordings_require_consent` BEFORE INSERT/UPDATE trigger (migration 018), which refuses audio against a non-consenting OR unverified-consent response (raises `check_violation` 23514). The application *also* pre-checks consent before upload (for a clean UX error), but the trigger is the invariant.

**Why:** consent-before-recording is an ethics boundary, not a UX nicety — it must hold regardless of the connection role or code path that writes the row, exactly the reasoning behind the D10 question-freeze trigger (`questions_draft_only`, migration 017). An app-only check can be bypassed by a future code path that forgets it; a trigger cannot. SECURITY DEFINER with a locked search_path, same pattern as 017.

**Orthogonality:** `audio_consent` (whether a response may be recorded) is independent of `collection_mode` (how the response was gathered, D60). An interview may be unrecorded — `collection_mode='interview'` with `audio_consent=false` is a valid, representable state.

### D59. v1 audio upload goes through a Server Action; direct-to-Storage rework is a pre-launch blocker

Audio upload (v1) sends the file through a Next.js Server Action (`uploadRecordingAction`), which streams it to the bucket via the authenticated client (so the proven `recordings_obj_owner_all` RLS authorizes every write — never service-role). The local dev limit is raised via `next.config.ts` `serverActions.bodySizeLimit = '50mb'` to match the bucket cap.

**Why this is acceptable for v1:** it's the simplest path for a solo researcher uploading occasional interview audio, and it reuses the full security model (RLS, consent trigger, audit, playback) on the real authenticated path.

**Pre-launch blocker — Vercel 4.5 MB body cap:** the Server-Action transport works locally but **Vercel caps serverless request bodies at 4.5 MB**, below a real interview's audio size — production uploads will be rejected at the platform layer regardless of `bodySizeLimit`. Before launch, rework to a direct-to-Storage signed-upload URL (browser → bucket, bypassing the Server Action body). The bucket, RLS, consent trigger, row model, playback, and audit all carry over; only the upload transport (`uploadRecordingAction` + the FormData call in `RecordingsSection.tsx`) changes. Tracked in STATUS "Known Open Items".

### D60. collection_mode is a data marker on the invitation, not a gate on a separate write path

A `collection_mode` enum (`self_completed` | `interview`) on `invitations`, NOT NULL default `self_completed`, inherited by the response through its invitation FK (deliberately no column on `responses`). It records HOW a response was gathered. Create-only — set at invitation creation, NOT editable via resend (resend rotates the token for the same run; it does not re-scope how the invitation is conducted).

**The interview workflow:** the researcher conducts the interview offline with a recorder, returns to the office, logs in as owner, creates an invitation marked `interview` (does not email it), opens the `/r/<token>` link herself, marks consent (including audio_consent), fills the answers via the existing respondent flow, and uploads the audio on the admin response page.

**Why no separate admin answer-entry UI (the deliberate non-build):** the respondent flow already collects answers. An interview is simply an invitation the researcher fills via its own link — so a parallel owner answer-entry screen would duplicate existing functionality and create two write paths into the same `answers` rows. `collection_mode` exists ONLY to distinguish the resulting data (dashboards, exports, the "Interview" chip on the responses list), not to gate a new write path. We explored owner answer-entry with provenance/freeze/audit and abandoned it once the workflow was clear: answers go through the respondent path regardless of who types them, so per-answer provenance would be inaccurate anyway — the honest marker lives on the invitation, not the answer.

**Orthogonality:** independent of `audio_consent` (D58) — collection_mode is how-gathered, audio_consent is whether-recorded.

### D61. Revoke invitation = three-op terminal kill (token rotation + status + lock), block-then-confirm

Revoke is the owner's terminal "kill this invitation" operation (wrong recipient, recipient no longer eligible, suspected leak). Status alone does NOTHING — neither `validate_invitation_token` nor `getSession()` checks `invitations.status`. A status-only "revoke" would have been theatre. So revoke performs three operations, together, all-or-none-by-effect:

1. **Rotate `token_hash`** to a freshly-minted hash whose plaintext is **discarded**. The new hash has no plaintext that can produce it, so validate's hash-then-lookup never matches. Old link permanently dead. (Same primitive resend uses to invalidate the old link on token rotation — D56.)
2. **Set `status='revoked'`** — terminal label for the admin UI's chip + button-visibility gating (Resend and Revoke both hide on terminal rows).
3. **Set `responses.is_locked = TRUE`** on every non-submitted response for this invitation. Kicks any active session at next page load — `getSession()` and `saveAnswer` both filter by `is_locked`. **Saved answers are RETAINED** — `is_locked` is a gate flag, not a CASCADE; the owner still reads everything that was saved (the data is intact, just write-unreachable from the respondent side).

**Block-then-confirm gate (the UX call):** if a non-submitted response exists, the action returns `error: "in_progress"` UNLESS the caller passes `confirmHardRevoke=true`. The UI catches this and surfaces an honest second confirmation: *"X has started answering. Revoking will lock them out of continuing — their saved answers are retained and visible to you, but they cannot add more or submit. The magic link will also stop working. Continue?"* The honest wording is load-bearing: the alternative (generic single-click revoke that silently destroys in-flight work) is worse than asking once. The submitted-response block is unconditional (same shape as resend's `already_submitted`) — an answered invitation is a research artifact; *withdrawing data* is a separate operation tied to consent withdrawal (not built).

**Race closure (the correctness call):** the pre-rotation in-progress read drives the gate decision; the **post-rotation re-read is the canonical lock target**. `validate_invitation_token` is the sole creator of `responses` rows (only INSERT INTO responses in the codebase, inside that SECURITY DEFINER function; RLS rejects all other inserts), and its `SELECT … FOR UPDATE` on the invitation row serialises against the rotation UPDATE — so any validate call that sneaks in during the gap either commits its INSERT before rotation (visible to the re-read) or sees the new hash and creates nothing. Without the post-rotation re-read, a sub-second window between gate read and rotation could leak an unlocked response.

**Terminal:** revoke is one-way. Re-inviting = create a fresh invitation (owner picks a new `ref_code`; uniqueness blocks reuse). Same call as resend's "no un-resend" — terminal operations stay terminal; reversal complicates the state space for negligible UX gain.

**Audit:** `invitation.revoke` (severity=warn — terminal cut-off is security-relevant), metadata is `invitationId` + `hadInProgressResponse` + `lockedResponseIds`. No PII (no email, name, or token). The pre-rotation block is NOT audited — UI gates are not destructive actions; auditing every "what's the state?" probe would flood the log.

**Smoke-proven on prod 2026-05-31** — Cases 1 (no-response), 2 (in-progress hard-revoke), 4 (already_revoked staleness via `router.refresh()`). Case 3 skipped because `already_submitted` is identical to resend's exercised path.

### D62. Email-template editor — single renderer covers all 3 platform emails; admin-invite typography deltas accepted as brand-unification; submission gains structural button guarantee

D22 Stage 2 extends the Stage-1 editor to manage the two remaining platform-sent emails (admin-invite, submission) alongside the participant invitation, using the same registry-driven flow (defaults-as-overlay, system-owned button hrefs, validated placeholders, send-test with inert URL, audit shape unchanged).

**One renderer, layout descriptor on TemplateSpec.** Pre-Stage-2 the renderer (`renderInvitationEmail`) hard-wired invitation's 5-section layout. Stage 2 generalises to `renderEmailTemplate(template)`, with the layout encoded in `TemplateSpec` fields: `sections` (order), `buttonSection` (which is the button label, always 'cta' today), `placement: Record<SectionKey, 'lead' | 'fine'>` (above-button vs below-divider), `linkify: SectionKey[]` (which sections get email/phone linkification). The HTML chrome (white card 520px / 0.5px border / blue inline-block button / per-paragraph styling rule) is uniform across all three templates so the brand stays consistent. **Divider is omitted entirely when a spec declares no fine sections** (submission) — not rendered as an empty element. The 5-section invitation shape is one composition of the general layout, not a special case.

**Invitation byte-equivalence preserved.** Per-paragraph styling rule (lead-last → 26px margin / 16px font; fine positions get 0 / 4px-top / 12px-top with 14px-font + #5f5e59 on the closer) reproduces pre-Stage-2 invitation HTML character-for-character. Plain text assembly (`leadParts.join("\n\n")` + blank + `${cta}:\n${href}` + blank + fine with blank-before-last) likewise byte-identical. Verified per-paragraph against the old hardcoded output.

**Admin-invite chrome unification — accepted deltas.** Today's hardcoded admin-invite shell used 15px font on the greeting + intro paragraphs and 18px bottom margin on the greeting; the unified shell uses 16px font and 16px margin. Net: +1px font (~7% larger glyphs), -2px margin gap. Both deltas are below real-world email-client variance (Outlook / Gmail / Apple Mail all render with their own ±1px CSS quirks anyway), and the alternative — per-section typography overrides in the spec — would have added 8+ new fields per template for a gain no recipient will see. Accepted as a strict brand-uniformity win; documented in the close-out commit + STATUS so a future-reader doesn't think the renderer regressed.

**Submission chrome change — B(i) structural button guarantee.** The pre-Stage-2 submission email used a bare `<div>` (no card, no button) with an optional `<a href>` that fell back to plain text when no URL was supplied. Stage 2 swaps to the same branded card + blue button as the other two templates, with `button_href` always being the response-detail URL. Owner-only recipient (Sura), so no external user notices the visual change; strict improvement (clearer visual + always-working button); same can't-break-the-link guarantee as invitation + admin-invite. The pre-Stage-2 optional path was unreached defensive code (`notifications.ts` always supplies the URL when `NEXT_PUBLIC_SITE_URL` is set, which is always in prod).

**EN-only template support architecture.** `TemplateSpec.bilingual: boolean` (added in Stage 1's TemplateSpec, exercised in Stage 2) cascades end-to-end: the editor reads it to HIDE the Arabic column (NOT render empty AR fields), the action layer skips per-locale AR validation when `false`, and the schema's `subject_ar` / `sections_ar` are already nullable (from Stage 1's `20260527120001_email_templates_sections.sql` migration — added explicitly for this Stage 2 forward-compat). The two EN-only templates (admin-invite, submission) store `subject_ar=NULL`, `sections_ar=NULL` if customized, defaults skip the `ar` block, and the editor doesn't render it.

**Caller zero-ripple.** `admin-invite.ts` and `submission.ts` are rewritten as thin wrappers mirroring post-D22 `invitation.ts`. Exported function signatures unchanged — `sendAdminInviteEmail({to, name, signInUrl})` and `sendSubmissionEmail({to, refCode, href})` — so the two call sites (`lib/actions/admins.ts:279`, `lib/notifications.ts:97`) need zero changes. Submission's `href` stays optional to match `notifications.ts`'s `emailHref` derivation; when undefined the wrapper aborts `{ok:false}` (owner still gets the in-app notification with a working relative href; no broken-button email).

**Migration `20260531120001_email_templates_id_widen.sql`.** Widens the `email_templates.id` CHECK enum (drop+re-add in a single tx) to allow `'admin-invite'` and `'submission'` alongside `'invitation'`. The four pre-existing aspirational ids (`reminder1`, `reminderFinal`, `thankYou`, `v2Migration`) stay in the allow-list — no app code writes them; removing would be unrelated behavioral change. Tx-safe, idempotent, no data migration.

**Smoke-proven on prod 2026-05-31** — 3 test emails to Saeed's inbox via the editor's Send-test path: branded card chrome on all three (unification proof), placeholders interpolated, EN-only UI confirmed for admin-invite + submission, inert URLs land on `/?preview=<id>-email` (public landing ignores query strings). Edit→test→reset cycle on admin-invite exercised, `template.reset` audit row written. Leftover Stage 1 customization on Participant invitation cleared via the same UI Reset path (one more exercise of `resetTemplateAction` before Sura touches it post-launch).

### D63. Withdraw response = owner-only soft delete (status column + structural CHECK + first-use of `alert` severity); cross-cutting filter pass keeps withdrawn rows out of every aggregation

Withdraw is the owner's tool for retracting a submitted response from research data (participant withdrew consent post-submission, data ethics issue surfaced, wrong-recipient submission, etc.). It operates **only on submitted responses** (an in-progress draft is the wrong tool's job — revoke the invitation instead, which locks the session and retains the draft). Three structural choices anchor the design:

**Soft delete with a denormalized `withdrawn_at`, audit_log as canonical actor source.** A new `responses.status TEXT NOT NULL DEFAULT 'active' CHECK ('active','withdrawn')` column flips on withdraw; an atomic UPDATE writes `status='withdrawn' + withdrawn_at=NOW()` together. IRB chain-of-custody is the load-bearing reason — the `consent_records` row (the cryptographic proof that consent was given) survives the withdraw, and the audit_log row at `'alert'` severity (action='response.withdraw') timestamps the retraction. Hard delete would erase the consent moment from the live DB (only the audit row would remain) — a real regression in IRB defensibility for negligible storage win. The denormalized `withdrawn_at` is a rendering convenience (detail page shows "Withdrawn at \<ts\>" without a join into the Vault-blind audit surface); the actor is **NOT** denormalized — `audit_log.actor_admin_id` is the one source of truth, set by the existing `tg_audit_log_fill_actor` trigger (D26/D54).

**`responses_withdrawn_state_consistent` CHECK** — same impossible-states-impossible discipline as `one_active_version_per_variant`. The constraint is `(status='active' AND withdrawn_at IS NULL) OR (status='withdrawn' AND withdrawn_at IS NOT NULL)`. The application code writes both columns in one UPDATE statement — but as a *contract*, not as a sequence that relies on the CHECK to catch ordering bugs. Any future code path that flips one without the other gets a 23514 at write time. Cheap structural guarantee, eliminates a class of future bugs.

**First-use of `'alert'` severity establishes the tier's precedent.** The codebase has `event_severity: 'info' | 'warn' | 'alert'`; no call site has used `'alert'` prior to D63. The tier is reserved for **data-altering admin actions on submitted research data**. Revoke is `'warn'` (terminal but pre-data — locks the link before any answers are submitted); admin-mutations on tags / notes / invitations are `'info'`. Withdraw is the first action that operates on a submitted research artifact and removes it from analysis — the natural anchor for the heaviest audit tier. Metadata is PII-free: `{ responseId, invitationId, refCode, consentSignedAt }` — never the signed name, never the recipient.

**Withdraw-then-resend re-opens the invitation slot (intentional).** Once a response is withdrawn, the resend gate and revoke gate both treat the invitation as if no submitted response existed (all 5 invitation gates in D63 filter to `status='active'`). This means resend after withdraw rotates the token and fires a fresh email under the same `ref_code`; revoke after withdraw works on the now-non-terminal invitation. The audit chain — `response.withdraw` at `alert` followed by `invitation.resend` or `invitation.revoke` — preserves the full history. To prevent re-use after withdraw, follow with revoke. The alternative semantics (withdrawn responses keep blocking resend/revoke as if still submitted) would have created a dead state — invitation labelled `submitted` but the data is gone — that's harder to reason about than the chosen "withdraw is a research-data removal, the invitation slot is back in play" model.

**`invitations.status` is NOT cascaded by withdraw (mixed-signal accepted).** `invitations.status` is a per-invitation lifecycle field, flipped to `'submitted'` whenever any response is finalised — it records that the invitation produced a submission, a historical fact independent of whether the resulting research data still exists. Withdrawing the response soft-deletes the research data but does NOT unwind the invitation lifecycle (no cascade, no UPDATE to `invitations.status`). On the invitations list, a withdrawn-response invitation therefore renders the `'submitted'` chip alongside an active Resend button — a mixed visual signal (submitted-but-resendable) that is semantically defensible because both facts are true: the invitation DID produce a submission, AND that submission was retracted so the slot is back in play (the D63 slot-reopens decision above). The authoritative withdrawal state lives on the response detail page (the "Withdrawn" header chip + the Withdrawal section card's timestamp view); the audit chain (`invitation.create` → `invitation.send` → `response.submit` → `response.withdraw`) preserves the full history. Optional polish for future iteration if Sura finds the mixed signal confusing in real use: an `(N withdrawn)` subtitle under the invitation's status chip in the list. **Deferred — not in scope for this PR.**

**Cross-cutting filter pass — 7 query + 2 in-memory cascade, no silent-leak vectors.** Withdrawn responses leak into any aggregation that doesn't filter them out. The fix is **scatter, not view** — only 7 of 14 `.from("responses")` sites need filtering; the other 7 are MUST-RETAIN (admin list + detail + repo getResponse — Sura needs to manage withdrawn rows) or NEUTRAL (writes + public session hydration + autosave gate, orthogonal to status). The 7 filter sites: `dashboard.ts:128` (parent set + cascade source), `feedback.ts:81`, and 5 invitation gates in `invitations.ts` (resend submitted/in-progress, revoke submitted/pre-rotation/post-rotation). The 2 in-memory cascade guards live in `dashboard.ts`'s answers and response_tags aggregation loops — those queries don't join responses, so they aggregate ALL rows by default; the cascade collects `activeResponseIds` from the parent fetch and skips children whose parent was withdrawn. ORDERING IS LOAD-BEARING (Set built before either child loop runs) — documented in the file. **`listResponses(supabase, options?: { hideWithdrawn?: boolean })`** is the one exception to "filter where you read" — the repo stays MUST-RETAIN by default, page callers opt-in via `?withdrawn=show` toggle (default OFF). Same `.from("responses")` line in the grep, two query paths under the hood.

**not_submitted precondition (mandatory).** The action returns `error: "not_submitted"` if `submitted_at IS NULL` — withdrawing an in-progress response is a category error (no research artifact yet). The component maps this to explicit guidance: *"Cannot withdraw an in-progress response. To stop a participant who has started but not submitted, revoke the invitation instead — that locks their session and retains the draft."* The CHECK doesn't enforce status vs submitted_at (those are orthogonal columns); the action-layer precondition is the only guard, and the 5 invitation-gate filters defensively apply `.eq("status", "active")` in case a future code path produces the impossible row.

**Migration `20260601120001_responses_status_withdraw.sql`.** Adds the two columns + the structural CHECK in one tx-safe migration. `DEFAULT 'active'` backfills every existing row; `IF NOT EXISTS` on column adds + `DROP CONSTRAINT IF EXISTS` on the consistency CHECK makes re-apply a no-op. No data migration. Saeed runs `supabase db push` + `supabase gen types` before code deploys (same lead-the-code rule as D61 / D22 Stage 2).

**Smoke-proven on prod 2026-05-31** — Cases (a), (b), (c) executed live on `main_researchers` against SMOKE-WD-INPROG + SMOKE-WD-SUBMITTED (synthetic-submit on the second via Studio SQL: `submitted_at = started_at + interval '5 minutes'`, `duration_minutes = 5`, `invitations.status = 'submitted'`). **(a)** Confirm dialog verbatim, inline success `"✓ Withdrawn at 5/31/2026, 4:25:01 PM"`, `router.refresh()` fired, header gained Withdrawn chip, Withdrawal card flipped to timestamp view, Withdraw button gone; server timestamp persisted as `2026-05-31 13:25`. **(b)** In-progress SMOKE-WD-INPROG detail page rendered with no Withdrawal section card and no header chip (UI gate via `isOwner && submittedAt`). **(c)** Stale Tab B (opened pre-(a)) clicked Withdraw → `"Already withdrawn — refreshing…"` inline, `router.refresh()` resync, server timestamp stayed `13:25` (action's step-3 idempotency caught the duplicate — no second write). **(d)** Skipped per D61 precedent — UI gate verified by code review; readonly action-layer gate identical pattern to revoke's forbidden audit. **Cross-cutting silent-leak proofs**: #1 Dashboard avg-duration flipped `"5 min"` → `"—"` post-withdraw (parent filter at `dashboard.ts:128` proven); #2 Feedback hub `/admin/analytics/feedback` rendered empty cleanly (cascade chain working); #3 Resend button became visible on SMOKE-WD-SUBMITTED row post-withdraw (D63 slot-reopens semantic decision proven live).

### D64. Auto-reminders + send-failure surface (Path B — token plaintext at rest); errorClass bucket keeps Resend's strings out of audit metadata

Two paired features land together because they share infrastructure: **auto-reminder dispatch** (~7d and ~14d after invitation send) via a Vercel cron and **send-failure visibility** (a "send failed" chip + audit row whenever Resend rejects a send). Reminders are necessary because Sura can't manually track 50+ outstanding invitations across two months of pilot + main collection; send-failure visibility is necessary because, pre-D64, a failed Resend was swallowed into a `console.error` Sura never saw — invitations would silently never arrive. The two surfaces are different (`reminder*_sent_at` stamps + `last_send_failed_at` stamp + chip) but the failure surface needed to be in place BEFORE the cron started auto-sending so any cron-layer failure has a UI artefact.

**Path B (reminders reuse the existing token) vs Path A (rotate per dispatch).** The load-bearing architectural choice. `lib/tokens.ts` (D44/D53) deliberately stores ONLY the SHA-256 hash; there's no cryptographic path back to plaintext. So a reminder needing a working CTA URL must either (A) mint a fresh token + rotate `invitations.token_hash` (the original invitation email's link DIES the moment the rotation commits — same UX as `resendInvitationAction`), or (B) persist the plaintext at mint time, encrypted by the same Vault key that protects `recipient_email_encrypted` and `signed_name_encrypted`, and decrypt at reminder dispatch. **Path A was rejected** because the original invitation email's link dying mid-pilot would surprise recipients who hadn't yet clicked — they'd return to a "this link is dead" page despite Sura having just sent them a reminder, an obvious UX wart. **Path B was chosen** and the new column `invitations.token_plaintext_encrypted` (migration `20260602100001`) stores the encrypted plaintext at create time + at every resend rotation. Reminders decrypt + reuse → the original URL works through both reminder dispatches. Blast radius is bounded by the existing Vault model: the plaintext-at-rest is encrypted with `pii_key`, accessible only via `decrypt_pii` (SECURITY DEFINER), and only read by the service-role cron at the moment of send (scoped to a single loop iteration, never logged, never in audit metadata). Same trust model as recipient PII — and if the Vault key is compromised, the invitation-token plaintext is the least of the platform's problems. Documented prominently in the cron route's header so a future maintainer doesn't "fix" the model by reintroducing rotation.

**Option A — resend preserves reminder stamps (manual nudge ≠ cycle restart).** When Sura clicks "Resend" on an invitation that already received `reminder1`, the action rotates the token + re-encrypts the new plaintext (Path B contract) BUT does NOT clear `reminder1_sent_at` / `reminder_final_sent_at`. The semantic: resend is a MANUAL nudge that continues the current outreach cycle, not a restart of it. If Sura just hit Resend, an auto-cycle firing on top of her manual outreach is exactly the noise she's avoiding by manually intervening. The alternative ("fresh link → fresh reminder cycle") is defensible but reads wrong against the rest of the model — resend = "send this person another copy of their working link"; revoke + create-new = "restart the cycle entirely with a new ref_code." Documented in RUNBOOK "Resend vs Revoke + Create new" so Sura knows which to pick.

**Caller-owned column writes + service-role audit fork.** STEP 6 widened all 4 email wrappers (invitation, reminder, admin-invite, submission) from `{ ok: boolean }` to a discriminated union `{ ok: true } | { ok: false, errorClass: 'send' | 'config' }`, then made each CALLER responsible for the `last_send_failed_at` column write + the audit row. The wrapper stays a pure send module. This mirrors the D63 STEP 3 sentAt pattern and naturally accommodates the cron's service-role context: Server Action callers (createInvitation / resendInvitation / inviteAdmin) use the standard `logAudit` (admin JWT carried by the authenticated client); the cron + the respondent submit fan-out (`notifyOwnersOfSubmission`) use the new `logSystemEmailFailure` helper (service-role direct insert, actor=`system`, narrow action enum, severity hard-coded `warn`, defensive shape mirroring `logFailedLogin`). The wrapper never needs to know whether it has auth context.

**PII discipline at the audit boundary (load-bearing).** Resend's `error.message` strings can echo the recipient address ("Failed to send to user@host"). The wrappers' return type carries only the `errorClass` bucket; the raw message is dropped before crossing into caller code. `console.error` lines (server-only, ephemeral) similarly log `refCode + errorClass=…` instead of the error object. `audit_log` metadata is `{ invitationId, kind, errorClass }` — never `error`, `errorMessage`, recipient, token, or Resend response data. The Phase 4 smoke (synthetic Resend failure via `RESEND_API_KEY` env swap) verified the discipline live: audit metadata = exactly `{"kind":"reminder1","errorClass":"send","invitationId":"<uuid>"}`, no PII anywhere.

**Pre-D64 row exclusion (forward-only, no backfill).** Rows that existed before migration `20260602100001` applied have `token_plaintext_encrypted IS NULL` (the plaintext was discarded at their original mint — there's no path to recover it). The cron's candidate query gates on `token_plaintext_encrypted IS NOT NULL`, so legacy rows are silently excluded from auto-reminders. Sura's manual resend (which rotates + populates the column on the way through) is the recovery path for those — same forward-only discipline as the D63 `sent_at` fix.

**Bonus latent-bug fix: `resendInvitationAction` try/catch.** STEP 6 surfaced that the wrapper's documented `throws on missing RESEND_API_KEY` contract was actually buggy at the resend call site — the action lacked a try/catch around `sendInvitationEmail`, so a missing key would propagate out of the action AFTER `token_hash` had already rotated. Result: old link dead, new link never sent, action 500s. Fixed in passing by adding the try/catch with structured `errorClass='config'` audit + badge writes. The action now consistently fails closed (old link survives the catch path because the rotation try block precedes it and gets its own error handler).

**Cron infrastructure.** New route `/api/cron/send-reminders` (GET, runtime=`nodejs`, dynamic=`force-dynamic`) authenticated by `Authorization: Bearer ${CRON_SECRET}` exact-match. Two sequential candidate queries (reminder1, reminderFinal — separate predicates, separate plans, deterministic if a row qualifies for both on the same day after a cron pause/backfill). Per-row dispatch isolated in try/catch (one bad row never kills the batch). Idempotency-by-design via the candidate query's `reminder*_sent_at IS NULL` gate + atomic POST-OK stamping (one UPDATE writes `reminder*_sent_at + last_send_failed_at: null`). Response JSON contains four counter numbers only — no refCode list, no IDs, no per-row breakdown, no errorClass distribution. Scheduled daily at `0 12 * * *` UTC via `vercel.json` (Hobby plan: within-the-hour precision; Pro: exact-minute — same schedule string).

**Withdraw non-cascade (D63) defense.** The cron's `status IN ('sent', 'opened')` gate is load-bearing: a submitted-then-withdrawn invitation keeps `invitations.status='submitted'` (D63 deliberately doesn't cascade `response.status='withdrawn'` to invitations), so withdrawn invitations are correctly excluded with no separate "skip if any response is withdrawn" check. Documented inline in the cron route + this entry so a future change that makes withdraw cascade gets re-evaluated against this gate.

**Smoke-proven on prod 2026-06-01** — 10 cases passed live via PR #3 (`d64-reminders-and-send-failure` merged). **Phase 1 (a–f, h):** cron fires, `reminder1_sent_at` stamps post-OK, `token_hash` UNCHANGED (Path B proven at DB layer), no failure audits, pre-D64 row excluded silently via the plaintext-IS-NOT-NULL gate, reminder email landed with the EN reminder1 template rendered correctly. **Phase 2 (g):** ORIGINAL invitation URL still works in incognito AFTER reminder fires — Path B's central promise proven end-to-end (the participant flow even bumped SMOKE-PATHB-001 status sent → opened with use_count 1/1; the link is fully functional, not just rendering). **Phase 3 (i):** re-curl returns `{sent:0, failed:0}` — idempotency proven, Vercel cron can fire >1× per window with zero double-send risk. **Phase 4 (j):** Option A (`.invalid` TLD) didn't fire failure (Resend silently accepted, returned 200 — confirms `.invalid` is accepted at API time and only bounces async, scope-deferred to a future Resend webhook integration); pivoted to Option B (`RESEND_API_KEY` env swap + redeploy), which fired correctly — response JSON `{sent:0, failed:1}`, `last_send_failed_at` stamped, `reminder1_sent_at` stayed NULL (natural retry preserved), send-failed amber chip rendered on `/admin/invitations`, audit metadata = exactly `{"kind":"reminder1","errorClass":"send","invitationId":"<uuid>"}` with NO `error.message`, NO recipient, NO token, NO Resend response data. `RESEND_API_KEY` restored + redeployed; prod back to functional state.

**Smoke observations** (documented for future readers): (1) Resend silently accepts `.invalid` TLD recipients and returns 200. Async bounces/complaints don't surface to `last_send_failed_at` via the wrapper — only sync API rejections do. A future Resend-webhook integration would close that "email looked sent but didn't arrive" gap; OUT of D64 scope. (2) Phase 4 audit row captured `ip=37.202.79.70` + `user_agent=curl/8.7.1` — Saeed's curl-origin metadata, not participant data. When the real Vercel cron fires (vs. manual smoke curl), `ip` will be a Vercel edge IP and `user_agent` will be `vercel-cron/1.0` per Vercel's docs. Both are operational metadata; neither is participant PII.

**10 commits merged as PR #3** — STEP 1 migration (`20260601130001`: reminder columns + view recreate + send-failure column), STEP 2 types regen, STEP 3 sentAt latent-bug fix, STEP 4 reminder template specs/defaults/editor list, STEP 5 `sendReminderEmail` wrapper, STEP 6 send-failure surface across 4 wrappers + repo + chip, STEP 6.5 `token_plaintext_encrypted` migration (`20260602100001`), STEP 6.6 write-site updates + grep audit (4 paired sites: createInvitation, resendInvitation in-progress, resendInvitation fresh, repo widening; 1 explicit skip on revoke with NULL column), STEP 7 cron route Path B, STEP 8 `vercel.json` schedule.

## Out of Scope (Explicitly)

- **AI translation** between EN/AR. Button exists in mock as placeholder; clicking does nothing. Real translation would require GPT-4 or DeepL API; deferred.
- **Word clouds / sentiment analysis**. ATLAS.ti does this; no need to duplicate.
- **Multi-tenancy**. Only one study runs here.
- **Mobile-first design**. Desktop-first; pages are responsive but not optimized for phones.
- **Public results page**. Responses are private forever.

## Methodological Defensibility

Several decisions are driven by what Sura's supervisor and ethics committee will want to see:

- Version freezing (D10, D11) → "we can prove no question was silently changed mid-study"
- Audit log retention (D24) → "we can prove who accessed what and when"
- Anonymization at the DB level (D4) → "read-only reviewers literally cannot see names"
- Transcript anonymization before publication (D16) → "no respondent can be identified from the analytical dataset"
- ATLAS.ti as the canonical coding tool (D18) → "qualitative analysis follows established CAQDAS methodology"

When tempted to simplify any of these, remember: the defense of the thesis depends on them.
