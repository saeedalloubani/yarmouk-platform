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
     supabase/migrations/*.sql | grep -v 'extensions\.'
   ```

   Extend the alternation when adding calls to other pgcrypto functions (`armor`, `dearmor`, `pgp_pub_encrypt`, `encrypt_iv`, etc.). The point is the grep is part of the review checklist for any crypto-touching migration — not a one-time audit.

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
