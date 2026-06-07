## 🟢 END-OF-SESSION-4 STATE (2026-06-07) — read first

The platform is production-green at `karasneh-research.org` and the pilot remains LIVE post-Sessions 3 + 4. D-counter is **D63 → D85 sequential, no gaps**. Session 4 shipped 3 D-numbers (D83 token-burn-timing + backfill; D84 ATLAS.ti wide-format export; D85 paired-bug filter handling) plus one operational track (DON-01 forensic recovery via Resend rotation). **13 invitations total** (12 SMEs + DON-01 rotated); **5 submitted** (OFF-JOR-02, OFF-JOR-03, RES-SY-01, RES-JOR-03, OFF-JOR-04 — the RES-SY-01 submission completed the geographic coverage matrix during Session 3); **2 in flight signed-and-active** (RES-JOR-02, DON-01); **2 unblocked-and-waiting** (RES-JOR-01, NGO-02 — both backfilled by D83 + manual reminder dispatched this session); **4 never-opened** (Off-1, NGO-01, RES-JOR-04, OFF-JOR-05). Reminder cron's next fire is June 10 (sent+7d window for the early invitees).

**Backup posture (updated):** three backups now offsite — `yarmouk-20260524-1206.yarmoukbackup` (pre-launch) + `yarmouk-20260605-1240.yarmoukbackup` (pre-D74) + **`yarmouk-20260607-1706.yarmoukbackup` (pre-D83 — the rollback point for the first migration since D69)**. `BACKUP_PASSPHRASE` + Vault `pii_key_v1` confirmed present in password manager. D83 established the **pre-flight SELECT discipline**: for any data-mutating migration, run the predicate SELECT in Studio AFTER backup BEFORE `supabase db push` and verify the affected-count matches the brief's expected blast radius — halt if it differs.

### Closed in Session 4 (2026-06-07)

- **D83 (PR #28) — Token burn timing fix + backfill 2 stuck participants.** First migration since D69 (`20260607120000_d83_token_burn_timing_and_backfill.sql`). Three-part:
  - **RPC redefinitions:** `validate_invitation_token` + `validate_invitation_code` lose `use_count = use_count + 1` from their fresh-claim UPDATE blocks. `opened_at` + status sent→opened transition + (code RPC only) `access_code_used_at = NOW()` forensic stamp all preserved.
  - **New `commit_consent_sign` SECURITY DEFINER RPC.** Atomic 3-write transaction: INSERT consent_records ON CONFLICT (response_id) DO NOTHING RETURNING id → if RETURNING returned a row, UPDATE invitations SET use_count = use_count + 1 → INSERT audit_log row (`invitation.consent_signed`, severity=info, metadata={invitationId, refCode, language, audioConsent}). Idempotent via ON CONFLICT; concurrent double-submit collapses to one consent row, one burn, one audit row. Triple-REVOKE + service_role-only EXECUTE grant (defends against Supabase ALTER DEFAULT PRIVILEGES; mirrors D26 log_audit grant pattern).
  - **Backfill.** UPDATE invitations SET use_count = 0 for the 2 stuck rows (RES-JOR-01 since June 3, NGO-02 since June 4) matching the "non-terminal status + no submission + pre-burned + still time-valid + no consent_records exists" predicate. Pre-flight SELECT in Studio confirmed exactly 2 affected rows before push.
  - **Code change:** `lib/actions/consent.ts:submitConsent` replaces `insertConsentRecord` + 23505 handling with a single `admin.rpc("commit_consent_sign", {...})` call. The `consentExistsForResponse` early-guard is preserved as a pre-flight optimization (saves one RPC round-trip on the back-button re-entry case).
  - **Post-deploy:** manual reminders dispatched for RES-JOR-01 + NGO-02 via the D79 Bell-icon write path. Both recipients received the same reminder1 email template as cron would send (`sendReminderEmail` reused byte-identically per FLAG E).
  - **3 files:** new migration + `lib/actions/consent.ts` + `lib/supabase/database.types.ts` (`commit_consent_sign` RPC signature added in alphabetical placement).
  - **New audit event** `invitation.consent_signed` is now part of the forensic trail for every signed consent going forward.

- **D84 (PR #29) — ATLAS.ti-friendly wide-format export alongside D74 long-format.** Largest single PR of the project arc (**1,324 +/163 - across 6 files** — 3 modified + 3 new). Research-driven scope expansion from the initial "tags in export" framing:
  - **Research finding (mid-session pivot):** ATLAS.ti's Survey Import expects WIDE-format (one row per respondent, one column per question) with column-header prefix syntax — `!` (document name), `:` (single-value group), `&` (date), `::` (code::label), `#` (multi-value group), `<` (ignore). Initial framing (tags as appended long-format rows) was incompatible.
  - **Sura is a FIRST-TIME ATLAS.ti user** (hasn't signed up yet). Friction-minimizing design goal: she should `Import > Survey` and have the data parse cleanly without manual reshaping.
  - **Strategy 3 (single-variant scope per wide-format export).** Studio verification revealed Q5-Q11 in `pilot_officials` and `pilot_researchers` have **completely DIFFERENT question text under the same code** (same Q-code, different meaning) — Strategy 1 union would have corrupted the data semantically. Strategy 3 was the correct call. Enforced at **dual layers**: UI modal collapses category to single-select radios when shape=wide; backend `getResponsesForAtlasExport` throws `AtlasMultiVariantError` when matched invitations span ≥2 `questionnaire_version_ids`.
  - **Column header schema (locked):** `!ref_code` → `:category` → `:nationality` → `:language` → `:collection_mode` → `&submitted_at` → `&consent_signed_at` → `Q1::<text_en>` … `Q14::<text_en>` → `F1::<text_en>` … `F4::<text_en>` → `#tags` last. Bilingual headers cap at English (ATLAS UI is English-default; AR garbles in some Excel readers). Dates emitted as ISO 8601 UTC Z with no milliseconds.
  - **PII EXCLUDED** from wide-format (`recipient_name` + `recipient_email` absent). Uses `invitations_redacted` view → zero `decrypt_pii` calls on the wide branch. Faster than long-format. Anonymization-at-the-API D31 posture extended to analytical pipelines. Long-format retains the existing D74 PII columns for supervisor identity-cross-reference workflows.
  - **3 new files:** `lib/exports/atlasti-xlsx.ts` (wide-format XLSX serializer with ATLAS prefixes; sheet name = variant; wrapText on Q-cols + #tags), `lib/exports/atlasti-csv.ts` (wide-format CSV, UTF-8 BOM + RFC 4180, symmetric to xlsx), `components/ExportModal.tsx` (client component replacing the prior inline Single + Bulk forms — shape radio with wide default per Q-I, scope radio, format radio, filter checkbox/radio groups, first-time-friendly explainer text).
  - **3 modified files:** `lib/repos/exports.ts` (additive `AtlasMultiVariantError` + `AtlasQuestion` + `AtlasResponseRow` + `AtlasExportPayload` + `AtlasExportFilters` + `getResponsesForAtlasExport`), route handler (three-axis grid: scope × format × **shape**; backward-compat `shape` default = `long`; filter param parsing + Strategy 3 backend defense), `/admin/exports/page.tsx` (modal trigger replaces inline forms).
  - **Audit metadata extended** with `shape` + `filters: {category?, nationality?, language?}` + `variant` (wide only). All non-PII (enum members + UUIDs + ref_codes).
  - **D74 + D75 long-format paths BYTE-UNTOUCHED.** `lib/exports/csv.ts` + `lib/exports/xlsx.ts` not modified. `getResponsesForExport` body unchanged.
  - **D63 cascade filter** (`.eq("status", "active")`) mirrored on the new repo helper.
  - **Tag separator: literal comma** (Q-K). Studio pre-flight confirmed tags table empty today. Backlog item filed for tag-name validation at apply time (forbid commas).
  - **ZERO new npm dependencies** — exceljs + native serialization reused.

- **D85 (PR #30) — Empty-filter handling fix + long-format filter wiring (bundled β).** Paired-bug discovery from D84 post-merge smoke; both bugs root-caused in the same architectural gap (modal exposed filter UX that the backend didn't honor honestly):
  - **Bug 1 — `parseList` absent-vs-invalid conflation.** When Sura left a filter group entirely unchecked, the modal omitted that URL param. `url.searchParams.get(<axis>)` returned `null` → `parseList(null, …)` returned `null` (the INVALID sentinel) → route 400'd "invalid <axis>" despite the modal inviting that input. Contradicted the D84 Q-E lock ("leave all unchecked = include all").
  - **Bug 2 (pre-existing D84 silent bug) — long-format pipeline dropped filters entirely.** `getResponsesForExport` had no filters arg; route's long-branch always called `{ scope: 'bulk' }` regardless of URL filter params. Sura's "long-format with category=officials" returned ALL submitted responses. Also contradicted the Q-E lock.
  - **Fix 1 (1-char semantic distinction):** `parseList` returns `[]` (absent → "no filter applied") vs `null` (invalid → 400). The route's existing `if (categoryList === null) return badRequest(...)` check now fires ONLY on invalid; absent passes through to the dispatch.
  - **Fix 2 (option β bundle):** `ExportScope` bulk arm extends with optional `filters` (new `ExportFilters` type exported alongside). `getResponsesForExport` gains in-memory filter pass at step 2b — between fetching invitations and the D75 decrypt fan-out. Filter posture mirrors `getResponsesForAtlasExport`: empty/undefined/missing axis → null Set → predicate returns true → filter skipped on that axis. **D75 parallel decrypt now operates on the narrowed set** — filters are also a perf win.
  - **Audit posture (Q-Audit lock):** `metadata.filters = {}` when no filters were applied (honest "no filter" signal); populated keys when filters present.
  - **Modal text unchanged** ("leave all unchecked to include all") — now matches backend reality on BOTH shapes.
  - **Strategy 3 enforcement unchanged.** `categoryList.length !== 1` still 400s wide+bulk with empty or multi-category.

- **DON-01 forensic recovery (operational, no D-number).** Complaint surfaced; reconstructed across 3 tables via 4 SQL queries; resolved via Resend rotation (use_count reset + fresh credentials dispatched). Post-D83, DON-01 + RES-JOR-01 + NGO-02 all have working links + manual reminders dispatched.

### Production observations end-of-session-4 (real-data, 2026-06-07)

- **D83 deploy went clean.** Pre-flight SELECT returned exactly 2 rows (RES-JOR-01 + NGO-02) BEFORE push — the discipline caught nothing wrong but proved the pattern. Migration applied via `supabase db push`. Backfill verified: post-deploy `SELECT use_count FROM invitations WHERE ref_code IN ('RES-JOR-01','NGO-02')` → both `0`. Other 11 invitations unchanged.
- **`commit_consent_sign` exercised by 0 new sign-ups during the session** (no new consent.sign actions fired since deploy — all 5 submitted responses pre-date D83). The RPC's first production fire will happen the next time a not-yet-signed invitation reaches `/consent` and the participant signs. Audit row visibility unchanged until then.
- **D84 wide-format smoke green for positive cases 1-8** (Sura's locked smoke plan). Modal opens with wide pre-selected, Strategy 3 single-category enforcement visible, XLSX downloads with full ATLAS prefix headers, PII columns absent, empty cells for variant-specific questions + untagged responses. Long-format regression-checked.
- **D85 fix verified by D84 smoke** — the empty-filter regression was the reason D85 existed. Post-D85: wide + 1-category + 0-nationality + 0-language succeeds.
- **Audit_log inspection** on `export.responses` rows confirmed `metadata.shape` + `metadata.filters` + `metadata.variant` (wide only) populated correctly; PII discipline maintained throughout (no `error.message`, no decrypted PII).

### D-counter (sequential, no gaps)

D63 → D85 closed end-to-end. D-numbers without DECISIONS.md / RUNBOOK paragraphs (D77 + D78 + D79 + D80 + D81 + D82 + D83 + D84 + D85) are documented by inline source comments + commit messages + PR bodies. Carry-forward flag from Session 3: if thesis-defense audit needs a single-source narrative for these, draft them then.

### Standing rules carried forward (UPDATED for Session 4)

Unchanged from Session 3:
- Read-first before EVERY D-number.
- Atomic PR per logical concern.
- PII discipline absolute (no `error.message`, no decrypted PII in audit metadata, refCode-only as identifier).
- Forward-only fixes (no destructive migrations, no rewriting prior migration files).
- `npm run build` before every push.
- Planning Claude always produces PR title + body alongside any PR URL.
- TIER-paste protocol for large Checkpoint 7 reviews.
- **D81 fix-up race lesson: NEVER push to closed PR branches.** Fresh branch off post-merge main, always. D83 / D84 / D85 all merged cleanly with no orphan commits — the rule continued to hold throughout Session 4.

NEW in Session 4:
- **Pre-deploy backup mandatory for data-mutating migrations.** Triggered + verified before D83 push (`yarmouk-20260607-1706.yarmoukbackup`).
- **Pre-flight SELECT discipline for data-mutating migrations.** Run the migration's predicate SELECT in Studio AFTER backup BEFORE `supabase db push`; halt if affected-count differs from the brief's expected blast radius.

### Active pilot guardrails — UPDATED for D83 + D84 + D85

In addition to existing carry-forward guardrails (validate_invitation_* RPCs, /r/[token] + /enter + /consent, cron, email render layer, D73 feedback hub, D74+D75 export hub, audit_log write path, owner-gate patterns, .expandable-summary, 12 unused feedback rows, lib/funnel-stages.ts D81 palette, computeActiveDurationMinutes D82, invitations.started_at first-answer semantic, Started ⊆ Consent invariant):

- **D83 `commit_consent_sign` SECURITY DEFINER RPC** — atomic 3-write transaction. ON CONFLICT (response_id) DO NOTHING + RETURNING id short-circuit is load-bearing for idempotency; don't change. Triple-REVOKE + service_role-only EXECUTE — don't loosen.
- **D83 use_count = burn-on-commit semantic** — counter only ever climbs inside `commit_consent_sign`. The use-exhausted defensive gate in both validate_* RPCs is now effectively unreachable on the normal flow but kept for prior-contract preservation (backlog item flagged for future cleanup).
- **D84 ATLAS column header schema** — `!ref_code` → `:` group columns → `&` date columns → `Q-code::label` columns → `#tags` last. ATLAS prefix mappings are vendor-defined; don't drift.
- **D84 Strategy 3 single-variant invariant** — dual-layer enforcement (UI single-select radios + backend `AtlasMultiVariantError`). Studio-verified that same Q-codes differ across variants; bypassing would semantically corrupt the export.
- **D84 wide-format PII exclusion (Q-J)** — wide-format reads `invitations_redacted` view; never decrypts; never includes recipient_name / recipient_email. Don't backdoor PII into the wide pipeline.
- **D85 `ExportFilters` empty-array semantic** — `[]` means "no filter applied for this axis" across both long-format and wide-format. Don't conflate with `null` (which now exclusively means INVALID input).
- **D85 audit metadata `filters: {}`** — emit always-present `filters` key in `export.responses` audit metadata. Empty `{}` is the honest "no filter" signal; populated keys signal filtered exports.

### NEXT QUEUE (green — top-of-stack first, post-Session-4 reordering)

**Operational (Sura-side / time-sensitive):**

1. **RES-JOR-01 + NGO-02 re-engagement** — both backfilled + manual-reminded today; watch for sign-up activity.
2. **DON-01 re-engagement** — recovered via Resend rotation earlier in Session 4; watch for response progression.
3. **June 10 cron fire** — automated reminder1 fires for the early invitees (sent+7d window).
4. **Sura tasks (carry-forward)** — read 5 submitted responses for thesis quality; apply Tags to submitted responses (will exercise D84's `#tags` export column for the first time); capture verbal feedback from participants; sign up for ATLAS.ti free trial + validate wide-format XLSX import works; iterate questionnaire for main study when ready; pilot retrospective fill-in (template at `/docs/pilot-retrospective-template.md`).

**Platform backlog (top-10, post-Session-4 reordering):**

1. **ExportModal — XLSX hint when shape=wide selected** (D84 backlog observation). First-timer UX polish: "ATLAS.ti recommends XLSX for survey imports."
2. **Format-on-shape-flip auto-switch** (D84 backlog observation). When user has long+csv selected and switches to wide, optionally auto-switch to xlsx unless they've explicitly chosen csv in this session. Tracker bit needed.
3. **Tag-name comma validation at apply time** (D84 Q-K backlog). Forbid commas in tag names via Server Action validation OR a CHECK constraint on `tags.name`. Locks in the D85 literal-comma assumption when Sura starts coding.
4. **errorClass naming normalization** (carry-forward from Session 3). `preview.ts` logs `'config'`; `reminder-manual.ts` logs `'decrypt'` for the same root cause.
5. **parseFlash + flashFailureMessage shared-helper extraction** (carry-forward). D79 duplicated across `/admin/page.tsx` + `/admin/invitations/page.tsx`. Extract to `lib/admin/flash.ts`.
6. **Dashboard inline-math consolidation** (D82 backlog). Dashboard inlines `computeActiveDurationMinutes` formula instead of calling the helper.
7. **Use-exhausted defense-in-depth gate cleanup** (D83 backlog observation). The `IF v_inv.use_count >= v_inv.max_uses THEN RETURN` block in both validate_* RPCs is now effectively unreachable on the normal post-D83 flow. Cleanup preserves prior contract; document as forward-only relaxation.
8. **D63 withdrawn-response edge** (D83 read-first E2). `validate_invitation_token`'s resumption gate doesn't filter `status='active'`. A withdrawn response with `is_locked=true` would still allow resumption-into-locked-questionnaire.
9. **Suspense-lazy email preview rendering** (carry-forward). Feature 4 eagerly decrypts all previewable rows; flip to lazy on-expand when main-study scale hits ~150 rows.
10. **D26 Phase ③ / ④** (carry-forward). Country/city geo (Vercel-header path: ~6-line patch + 1 migration) + unknown-email-failure logging.

### §9 Latest applied migration — UPDATED

`20260607120000_d83_token_burn_timing_and_backfill.sql` (D83). First migration since D69's `20260602130000_invitations_redacted_collection_mode.sql`. The intervening D70 → D82 + D84 + D85 all deliberately avoided migrations (operational + repo-only + serializer-only changes). Migration counter for §5 advances from "19 total" to "20 total" if/when §5 is refreshed (out of scope here — §5 hasn't been updated since Session 2b).

### Session 3 TASK_STATE refresh — STILL PENDING

The Session 3 closure PR (`docs/d82-task-state-refresh`, commit `a7d3441`, opened end of Session 3) was authored to add an "END-OF-SESSION-3 STATE (2026-06-06)" block covering D81 mega-bundle + D81 icon-button fix-up + D82 paired follow-on. **That PR has NOT been merged** — the branch still exists on origin (`origin/docs/d82-task-state-refresh`) but no merge commit. The Session 3 events (D81, D82, the standing rule "never push to closed PR branches") are documented inline in commit messages + PR bodies + DECISIONS.md, AND are referenced throughout this Session 4 block. Operational debt: merge the Session 3 refresh PR for full continuity. Out of scope for the current Session 4 closure PR.

---

## 🟢 END-OF-SESSION-2 STATE (2026-06-05) — read first

The platform is production-green at `karasneh-research.org` and **the pilot is LIVE**. All 4 pilot variants (`pilot_officials`, `pilot_researchers`, `pilot_donors`, `pilot_ngos`) are `active`; the 5 main variants remain in `draft`. **7 SME invitations sent**; **1 submitted** (OFF-JOR-02 — Jordanian official, 14 answers, real Arabic content, ~58-minute engagement); **4 stalled "started, not submitted"** (DON-01, RES-JOR-01, OFF-JOR-03, NGO-02); **2 never opened** (Off-1, NGO-01). **2 manual reminders dispatched in production this session** via the D79 Feature 3 write path (DON-01 + OFF-JOR-03). Reminder cron fires ~June 10 — D72's `{name}` placeholder + decrypt path's first real exercise under load; D79 manual-reminder coexistence preserves the cron schedule by design (FLAG E).

**Backup posture:** unchanged — `yarmouk-20260524-1206.yarmoukbackup` (pre-launch) + `yarmouk-20260605-1240.yarmoukbackup` (pre-D74) both on Saeed's Mac + offsite. `BACKUP_PASSPHRASE` + Vault `pii_key_v1` confirmed present in password manager. D77–D80 needed no new backup (all pure read-path or surface-additive; D79 added a write path but it reuses the verified D70+D71+D72 email render layer + D64 reminder wrapper byte-identically).

### Closed since the 2026-06-05 (earlier today) refresh

- **Item 1 — Pilot status diagnostic (2026-06-05, no PR).** Studio queries A–G against live production data verified: 7 invitations / 1 submitted / 5 started responses (1 finalized + 4 active) / 24 admin.login.failed rows (clustered June 1 retry) / 0 cron firings yet / 4 pilot variants active / 170 audit rows. Surfaced D26 ① + ② as already-wired (and lit D77 + D79 candidates from the cell-truncation + dashboard-shape observations).
- **Item 2 — D26 read-only audit (2026-06-05, PR #19 — docs only).** Read-only verification clarified phase status against live data. **Phase ① (IP + UA capture):** WIRED end-to-end via `lib/audit.ts:getRequestMeta()`. Production: 170/170 rows have IP, 163/170 have UA. **Phase ② (admin.login success + failed):** WIRED + actively exercised — 32 success + 24 failed rows. **Phase ③ (country/city geo):** NOT WIRED, correctly deferred. Two future paths documented: (a) MaxMind GeoLite2 + license, or (b) Vercel auto-injected `x-vercel-ip-country`/`x-vercel-ip-city` headers (~6-line patch + 1 migration; no per-request lookup cost). **Phase ④ (unknown-email-failure):** NOT WIRED, status unchanged. DECISIONS.md amended with "Audit confirmation (2026-06-05)" block under existing D26 entry; RUNBOOK note added.
- **D77 (2026-06-05, PR #20)** — `/admin/security` Details cell now expands in-place. Native HTML `<details>` element with `<summary>` showing the formatMetadata one-liner and `<pre>` body showing pretty-printed JSON. Pure no-JS (Tab/Enter/Space keyboard nav out of the box; native disclosure triangle as the affordance). Falls back to the original truncated span for scalars / arrays / nulls / empty objects (no expansion when there's nothing better to show). 1 file touched.
- **D78 (2026-06-05, PR #21)** — Restored the disclosure indicator that D77's `block` className inadvertently killed (Tailwind's `display: block` removed the default `list-item` rendering). Pure CSS pseudo-element with `[open]` rotation: `▶` collapsed → `▼` open via `\25B6` / `\25BC` escapes; RTL-safe `padding-inline-end`. Named class `.audit-summary` added to globals.css; 1-word JSX className update on security/page.tsx. 2 files touched.
- **D79 (2026-06-05, PR #22) — Sura-value mega-bundle, 4 features in one PR.**
  - **Feature 1 — Pilot dashboard extension.** EXTENDS the existing Session-4 dashboard (per read-first FLAG A — preserve real-data KPIs Sura was using). Adds: flash banner (URL-driven, no client JS), "Needs a nudge" stalled-invitations action surface (owner-only) with one SendReminderButton per row + chip distinguishing "Never opened" vs "Started, not submitted", 4-stage cumulative funnel chip strip (replaces old KPI cards), operational cron-schedule footer with deep links. Completion-by-Category + Recent Activity + At-a-glance preserved verbatim.
  - **Feature 2 — Response reader (`/admin/responses/[id]`).** Per-question block now shows BOTH languages of the question (EN above, AR below, both muted/prose), followed by the participant's answer in a punchier treatment (`text-[15px] text-ink leading-relaxed whitespace-pre-line`, `dir` matches `response.language`). New "Reader summary" footer card with engagement counts + Export Responses link. Identity / Invitation / Response / Consent / Withdrawal / Tags / Notes / Recordings cards preserved verbatim; null-driven PII redaction preserved verbatim.
  - **Feature 3 — Manual reminder write path.** New owner-only `POST /admin/invitations/[id]/send-reminder` powering a `SendReminderButton` server-component (Path Z locked — native `<form>` + inline `onsubmit="return confirm(...)"` via `dangerouslySetInnerHTML`; refCode JSON.stringified + HTML attribute-escaped across the JS + HTML attribute contexts). Reuses `sendReminderEmail` from `lib/email/reminder.ts` BYTE-IDENTICAL to cron's reminder1 (recipient sees the same email). Two new audit actions: `invitation.reminder_manual` (info) + `invitation.reminder_manual.failed` (warn). **Rate-limited via audit_log** (10-minute per-invitation cooldown — audit_log is source of truth per FLAG D; no schema change). **Does NOT touch** `reminder1_sent_at` / `sent_at` / `use_count` / `last_send_failed_at` (FLAG E — manual nudge does not suppress cron's future fire; recipient may receive manual + cron close together, accepted by design). PII discipline mirrors cron verbatim: 3-arg `console.error` form with refCode + errorClass only; NEVER `error.message`, NEVER recipient address, NEVER token URL. Decrypted PII scoped to function — never in audit metadata.
  - **Feature 4 — Email preview on `/admin/invitations`.** Reuses the exact `renderEmailTemplate` + `resolveTemplate` + `getDefaults` pipeline from `lib/email/reminder.ts` so preview is byte-identical to what cron or the manual button would send. Owner-only; eager batched decrypt + Promise.all-rendered (~300–500ms at pilot scale). Returns `null` on any decrypt failure (best-effort, no error chrome). Renders via `dangerouslySetInnerHTML` inside a styled `<details>` using the shared `.expandable-summary` class.
  - **Foundation — `.audit-summary` → `.expandable-summary`** rename in globals.css; D77/D78 callers updated in-place. Two surfaces (audit log Details cell + invitation preview) now share the selector.
  - 10 files / 1,682 insertions / 149 deletions / net +1,533 lines.
- **D80 (2026-06-05, PR #23)** — Funnel Started count semantic fix. D79 smoke surfaced internal inconsistency: funnel said Started=1 (14%) while stalled table immediately below showed 4 rows with chip "Started, not submitted". Root cause was two definitions of "started" coexisting (`invitations.started_at` populated on first answer save via Session 2b; `responses.started_at` populated when responder reaches `/consent`). `getPilotFunnel` read invitations-side only; `getStalledInvitations` reads responses-side. The 4 stalled responders hit `/consent` but never saved Q1 → invitations-side undercounts. Fix: `Set<string>` collector unions both signals; one extra scoped responses-side query with server-side `.not("started_at", "is", null)` filter. Sent / Opened / Submitted unchanged (no responses-side divergent semantic). 1 file touched (`lib/repos/pilot.ts`). Post-D80: funnel reads Started=5 (71%) — matches stalled-table.

### End-of-session production observations (real-data, 2026-06-05)

- **Manual reminder write path live + verified.** 2 reminders dispatched to real SMEs this session (DON-01 + OFF-JOR-03). 10-minute cooldown enforced and observed. Vault decrypt cascade (email → token → access_code → name) verified non-fatal on name failure per D72. Cron schedule untouched: `reminder1_sent_at` + `sent_at` + `use_count` preserved on manually-nudged invitations (matches FLAG E intent).
- **`.expandable-summary` shared class verified** on BOTH `/admin/security` (audit log Details cells, 170-row prod data) AND `/admin/invitations` (per-row email preview disclosures). Single CSS pattern, two surfaces.
- **Path Z native `confirm()` dialog** working in production via `dangerouslySetInnerHTML`-emitted form — no React state, no client component, no modal scaffolding. Confirms the architectural pattern is reusable for future write-path triggers.
- **audit_log row inspection on manual-reminder rows**: confirmed `{invitationId, kind: "reminder1", triggeredBy: "manual"}` metadata shape — NO decrypted PII, refCode as resource (public id), all actor fields populated via the BEFORE-INSERT trigger.
- **Funnel UX-consistent post-D80**: Sent=7, Opened=5 (71%), Started=5 (71%), Submitted=1 (14%) — matches stalled-table chip semantic.

### D-counter (sequential, no gaps)

D63 → D80 closed end-to-end. Each operational D-number has DECISIONS.md entry + (where operational) RUNBOOK paragraph. D77 + D78 + D79 + D80 are pure read-path / surface-additive / cosmetic-CSS changes; no DECISIONS.md or RUNBOOK update was authored for these four since the changes are self-explanatory from inline source comments + commit messages + PR bodies — flag for future-Saeed if a thesis-defense audit needs a single-source narrative for them.

### NEXT QUEUE (green — top-of-stack first)

1. **errorClass naming normalization.** D79 surfaced an inconsistency: `lib/email/preview.ts` logs `'config'` for decrypt failure; `lib/email/reminder-manual.ts` logs `'decrypt'` for the same root cause. Reconcile across the bucket dictionary (`'send' | 'config' | 'decrypt' | 'not_found' | 'ineligible'`) so audit metadata + log lines tell a consistent story.
2. **parseFlash + flashFailureMessage shared-helper extraction.** D79 duplicated these helpers across `/admin/page.tsx` and `/admin/invitations/page.tsx`. Extract to `lib/admin/flash.ts` or similar — DRY pass.
3. **Suspense-lazy email preview rendering.** Feature 4 eagerly decrypts + renders all previewable rows on `/admin/invitations` page load. At pilot scale (~7) this is ~300-500ms; main-study scale (~150 rows × 3 decrypts = 450 RPCs) ~1-1.5s. Flip to lazy on-expand via Suspense + a per-row server-action endpoint when needed.
4. Per-variant feedback breakdown (D73 foundation — main-study follow-on).
5. Per-category bulk export filtering (D74 follow-on — easy add to `getResponsesForExport`).
6. Wide-format export pivot (D74 follow-on — alternative to long-format).
7. Per-version export labelling (when V2 launches — add `questionnaire_version` column).
8. Bulk invite for main study scaling (current flow is one-at-a-time).
9. Cross-variant analytics for main study (D73 enabled the foundation).
10. Rate-limit hardening on `/enter` (D66's best-effort in-memory → per-IP store).
11. D66 smoke cases 4 + 5 retroactive (invalid-code audit row check + resend rotation reveal).
12. **D26 Phase ③ implementation** (country/city geo). Per audit Item 2: Vercel-header path is ~6-line patch + 1 migration (`p_country` + `p_city` log_audit signature extension). MaxMind path needs license. Tackle when geo signal becomes load-bearing.
13. D26 Phase ④ unknown-email-failure logging (Supabase dashboard auth logs cover it meanwhile).
14. Saved filter presets for `/admin/security` (D76 enhancement — bookmarkable already, but a saved-preset chip would be a UX win for recurring filter combinations).

### PENDING SURA DECISION (yellow)

- **Main-study D66 defense decision (post-pilot).** Keep OTP-style for participants in main, or simplify? Depends on pilot UX feedback.
- **D74 follow-ons priority order.** Per-category filtering vs wide-format pivot vs streaming — order depends on what Sura's ATLAS.ti pipeline asks for first.

### PENDING SURA ACTION (red)

- Pilot monitoring + completion (read F1-F4 feedback rolling, watch for blockers from the 6 in-flight participants; D79 dashboard's stalled-invitations table now surfaces nudge candidates in one place).
- Main study planning (post-pilot, depends on feedback).

### Active pilot guardrails (DO NOT TOUCH while pilot live)

- `validate_invitation_token`, `validate_invitation_code` RPCs
- `/r/[token]`, `/enter`, `/consent` routes
- `invitations` table schema (additive columns fine; renames/drops NOT)
- Pilot questionnaire variants (active — destructive changes orphan invitations)
- Reminder cron logic (D72 added 4th decrypt step; D79 manual-reminder path verified to coexist — cron schedule preserved; first cron fires ~June 10)
- Email template rendering layer (D70 + D71 + D72 three-layer defensive stack; cross-client verified; BOTH D70's CSS layer AND D71's `<br>` fallback are required; D79 Feature 4 preview reuses this layer byte-identically)
- D73 feedback hub aggregation (let it bake; first non-trivial render happens on category #2's submit)
- D74 export hub + D75 parallel-decrypt path (real-data-verified; OFF-JOR-02 round-trip clean across 4 formats × 2 perf modes)
- D79 manual-reminder write path (live + verified; reuses verified D70+D71+D72 email render layer + D64 reminder wrapper byte-identically; 10-min cooldown via audit_log)
- `log_audit` RPC + `audit_log` schema (D76 + D79 added new actions as data; write path unchanged)
- `/admin/security` + `/admin/exports` + `/admin/invitations` + `/admin/responses/[id]` owner-gate patterns (mirror, **do not modify**)
- `.expandable-summary` shared selector (D78 → D79 abstraction; two surfaces depend)
- The 12 unused feedback question rows (researchers/donors/ngos × F1–F4 — intentional architecture)

### Safe areas for new work

- errorClass normalization, flash-helper extraction, Suspense-lazy preview rendering, analytics, per-variant feedback breakdown, audit-log UI follow-ons (D76 foundation), rate-limit hardening on `/enter`, D26 ③/④ wiring, saved filter presets.

### §9 Latest applied migration — UNCHANGED

D70 → D80 added zero migrations. Counter remains at `20260602130000` (D69 — `invitations_redacted` adds `collection_mode`). Next migration is `>= 20260602130001`.

---

## 🟢 PILOT-ACTIVE STATE (2026-06-05, end-of-session) — read first

The platform is production-green at `karasneh-research.org` and **the pilot is LIVE**. All 4 pilot variants (`pilot_officials`, `pilot_researchers`, `pilot_donors`, `pilot_ngos`) are `active`; the 5 main variants remain in `draft`. **7 SME invitations sent**; **1 submitted** (OFF-JOR-02 — Jordanian official, 14 answers, real Arabic content, ~57-minute engagement); **6 in flight** (5/7 opened, 71% open rate; zero send failures; zero expired). First reminder cron fires ~June 10 — D72's `{name}` placeholder + decrypt path's first real exercise under load.

**Backup posture:** unchanged — `yarmouk-20260524-1206.yarmoukbackup` (pre-launch) + `yarmouk-20260605-1240.yarmoukbackup` (pre-D74) both on Saeed's Mac + offsite. `BACKUP_PASSPHRASE` + Vault `pii_key_v1` confirmed present in password manager. D75 + D76 needed no new backup (D75 pure-perf, D76 read-only).

### Closed since the 2026-06-05 (earlier today) refresh (D75 + D76)

- **D75 (2026-06-05, PR #16)** — `getResponsesForExport` decrypt phase parallelized. `Promise.all` over invitations (each itself a Promise.all of name + email decrypts). Total RPC depth: O(N×2) sequential → O(1) batched. Pilot scale (≤14 decrypts): ~2s → ~0.5s. Main study scale (100–200 decrypts): ~30–60s → ~3–5s. Semantics preserved exactly: same `Map<string, InvDecrypted>` shape, same `ExportDecryptFailedError` class signature, same 3-arg `console.error` log lines (PII echo discipline), same first-observed-rejection behaviour. Single file touched (`lib/repos/exports.ts`). No new deps. Closed the optimization backlog item flagged during D74 TIER 1+2 review.
- **D76 (2026-06-05, PR #17)** — `/admin/security` audit-log viewer gains filters (severity, date range, action, actor, resource ILIKE), severity-breakdown summary chips with drill-in semantics, and 250-row page cap (was 100). URL-persistent filter state via HTML method=GET, no client JS — filtered views are bookmarkable. Rolling-window date presets ("Last 24 hours / 7 days / 30 days") avoid the UTC-midnight-vs-Jordan-time mismatch; custom range uses inclusive-of-day semantics (`T23:59:59.999Z`). `lib/repos/audit.ts` extended with `AuditFilters` type, `getAuditSummary` (3 parallel count-only round-trips, drill-in short-circuits when severity filter active), `listDistinctActions` (data-sourced, new actions appear automatically). 4 files touched (2 code + 2 docs). `audit_log` table READ-ONLY across the PR; `log_audit` RPC write path unchanged.

### End-of-session production observations (real-data)

- **170 rows in `audit_log`**, **16 distinct action types**. Filters + chip drill-in + bookmarkability all verified against real data via 9 production smokes (Saeed).
- **IP capture is wired and working** — `audit_log.ip` is populated (e.g. `37.202.78.69` on Saeed's export actions in the D76 smoke screenshot). That means D26 ① (IP + UA capture via `log_audit` extended signature, migration `20260524120001`) is at least partially live. `country` / `city` columns still NULL — D26 ③ (geo resolution) remains deferred as documented. **Next-session work:** a read-only audit of when/where D26 ① got wired vs what TASK_STATE / DECISIONS say is deferred would clarify the D26 picture before tackling ③.
- **D77 candidate observed during D76 smoke:** the Details column truncates mid-string. Pre-D76 behaviour from the preserved `formatMetadata` helper — not a D76 regression — but with metadata-rich rows now in the table, the crop matters. Likely fix: inline `<details>` element or CSS-only popover for full-string reveal; ~30–50 line change to `security/page.tsx`; can stay no-JS.

### D-counter (sequential, no gaps)

D63 → D76 closed end-to-end. Each operational D-number has DECISIONS.md entry + (where operational) RUNBOOK paragraph. D75 has the perf-refactor PR but no DECISIONS entry (closure-of-backlog; brief didn't ask for one).

### NEXT QUEUE (green — top-of-stack first)

1. **D77 candidate — Audit log Details cell expandable metadata display.** Observed during D76 smoke. Inline `<details>` element or CSS-only popover; ~30–50 lines to `security/page.tsx`; can stay no-JS.
2. **D26 surface audit (read-only).** Clarify what's actually wired (D26 ① IP + UA capture confirmed working from prod data) vs what TASK_STATE / DECISIONS say is deferred. Drives whether ③ (country / city resolution) is the next D-number or whether ② also lands free.
3. Per-variant feedback breakdown (D73 foundation — main-study follow-on).
4. Per-category bulk export filtering (D74 follow-on — easy add to `getResponsesForExport`).
5. Wide-format export pivot (D74 follow-on — alternative to long-format).
6. Per-version export labelling (when V2 launches — add `questionnaire_version` column).
7. Bulk invite for main study scaling (current flow is one-at-a-time).
8. Cross-variant analytics for main study (D73 enabled the foundation).
9. Rate-limit hardening on `/enter` (D66's best-effort in-memory → per-IP store).
10. D66 smoke cases 4 + 5 retroactive (invalid-code audit row check + resend rotation reveal).
11. D26 ③ geo / device capture (`country` / `city` columns — IP capture already live).

### PENDING SURA DECISION (yellow)

- **Main-study D66 defense decision (post-pilot).** Keep OTP-style for participants in main, or simplify? Depends on pilot UX feedback.
- **D74 follow-ons priority order.** Per-category filtering vs wide-format pivot vs streaming — order depends on what Sura's ATLAS.ti pipeline asks for first.

### PENDING SURA ACTION (red)

- Pilot monitoring + completion (read F1-F4 feedback rolling, watch for blockers from the 6 in-flight participants).
- ~~Pilot activation + launch~~ — DONE (7 invitations sent; pilot live).
- Main study planning (post-pilot, depends on feedback).

### Active pilot guardrails (DO NOT TOUCH while pilot live)

- `validate_invitation_token`, `validate_invitation_code` RPCs
- `/r/[token]`, `/enter`, `/consent` routes
- `invitations` table schema (additive columns fine; renames/drops NOT)
- Pilot questionnaire variants (active — destructive changes orphan invitations)
- Reminder cron logic (D72 added 4th decrypt step; first fires ~June 10 — name-decrypt path's first real exercise)
- Email template rendering layer (D70 + D71 + D72 three-layer defensive stack; cross-client verified; BOTH D70's CSS layer AND D71's `<br>` fallback are required cross-client)
- D73 feedback hub aggregation (let it bake; first non-trivial render happens on category #2's submit)
- D74 export hub + D75 parallel-decrypt path (real-data-verified; OFF-JOR-02 round-trip clean across 4 formats × 2 perf modes)
- `log_audit` RPC + `audit_log` schema (D76 read-only enhancement; write path unchanged)
- `/admin/security` owner-gate pattern (mirrored by D74 + D76; **do not modify the source**)
- The 12 unused feedback question rows (researchers/donors/ngos × F1–F4 — intentional architecture for when those variants submit)

### Safe areas for new work

- D77+ work, admin UI improvements not touching active pilot surfaces, analytics, per-variant feedback breakdown (D73 foundation), audit-log UI follow-ons (D76 foundation), rate-limit hardening on `/enter`, D26 ③ wiring.

### §9 Latest applied migration — UNCHANGED

D70 → D76 added zero migrations. Counter remains at `20260602130000` (D69 — `invitations_redacted` adds `collection_mode`). Next migration is `>= 20260602130001`.

---

## 🟢 PILOT-ACTIVE STATE (2026-06-05) — read first

The platform is production-green at `karasneh-research.org` and **the pilot is LIVE**. All 4 pilot variants (`pilot_officials`, `pilot_researchers`, `pilot_donors`, `pilot_ngos`) are `active`; the 5 main variants remain in `draft`. **7 SME invitations sent**; **1 submitted** (OFF-JOR-02 — Jordanian official, 14 answers, real Arabic content, ~57-minute engagement); **6 in flight** (5/7 opened, 71% open rate; zero send failures; zero expired). First reminder cron fires ~June 10 — D72's `{name}` placeholder + decrypt path's first real exercise under load.

**Backup posture:** fresh full snapshot `yarmouk-20260605-1240.yarmoukbackup` taken pre-D74 and copied offsite to the Mac. Both password-manager secrets (`BACKUP_PASSPHRASE` + Vault key `pii_key_v1`) confirmed present at backup time.

### Closed since the 2026-06-02 refresh (D70 → D74)

- **D70 (2026-06-03)** — Email template render: `white-space: pre-line` on the prose `<p>` wrappers so author-entered newlines render as soft line breaks. CSS-only Gmail/Apple-Mail path. Migrated nothing; default templates unchanged.
- **D71 (2026-06-03)** — Outlook/O365 fallback: `\n → <br>\n` post-escape replacement in `render.ts`'s `escapedSections` loop. Outlook's HTML standardisation strips `white-space`, so D70 alone failed there. D70 + D71 ship together (defensive layering) and BOTH layers are required cross-client — do not remove either.
- **D72 (2026-06-04)** — `{name}` placeholder usable in the `intro` section of the 3 participant templates (invitation / reminder1 / reminderFinal). ALLOWED-only (not required). Wrapper inputs widened with `name?: string | null`; renderer defaults to `""` when undefined; create flow passes plaintext name directly, resend + cron decrypt `recipient_name_encrypted` non-fatally (decrypt-fail degrades to empty name so the link still ships — contrast with email/token/access_code where decrypt-fail aborts). Bundled fix on line 581 closed a latent PII-discipline gap. First reminder cron (~June 10) is the path's first real exercise.
- **D73 (2026-06-05)** — Pilot-Feedback Hub (`/admin/analytics/feedback`) now aggregates by `question_code` across all 4 active pilot variants. Each variant has its own F1–F4 rows (16 total with byte-identical text); before D73, the hub rendered 16 sections (12 empty). Surfaced when OFF-JOR-02 became the first real submission. Fix is pure read-aggregation in `lib/repos/feedback.ts`: `idToCode` built across all variant rows, dedupe questions to one per code, re-key answers join from `question_id → question_code`. Cross-variant pooling locked as the v1 unit (questionnaire UX signal). Per-variant breakdown is a main-study follow-on.
- **D74 (2026-06-05)** — Pilot Response Export Center at `/admin/exports`. Owner-only (gate mirrors `/admin/security` verbatim). Two scopes × two formats (single/bulk × CSV/XLSX). Long-format: 1 row per (response × answer), 18 denormalized columns. PII decrypted inline (`recipient_name` + `recipient_email`) with **ALL-OR-NOTHING posture** — any decrypt failure aborts the entire export, writes `warn` audit with `errorClass='config'` (never `err.message`), surfaces safe banner. **One audit entry per attempt** (success → `info` with `{scope, format, responseCount, refCodes}`; failure → `warn` with `{scope, format, errorClass}`); no "started" row. Token plaintext + access-code ciphertext + `consent_records.signed_name_encrypted` are NEVER exported by design. Filters: `submitted_at IS NOT NULL AND status='active'` (withdrawn excluded; `is_locked` not a filter). `Cache-Control: no-store, max-age=0` on every response. `exceljs ^4.4.0` added (CLAUDE.md's anchored library for D18/D19 ATLAS.ti exporter; server-side only).

**Operational close (between D72 and D73):** `pilot_officials` was accidentally `closed` mid-pilot via a Studio click; restored to `active` via Studio UPDATE while invitations were still in flight (D64's `version.activate` audit pair from the same window remains the cleanest forensic trace). No respondents lost data.

### D-counter (sequential, no gaps)

D63 → D74 closed end-to-end. Each D-number has DECISIONS.md entry + (where operational) RUNBOOK paragraph. Next D-numbers slotted to top of green queue below.

### NEXT QUEUE (green — top-of-stack first)

1. **D75 — Parallelize export decrypt loop.** Current `getResponsesForExport` is sequential (N invitations × 2 decrypts = 2N RPC round-trips). Fine at pilot scale (≤7). Bulk export at main-study scale (50–100+) will be noticeably slow. `Promise.all` + race-to-first-fail short-circuit. Flagged during D74 TIER 1+2 review.
2. **D76 — Audit log UI enhancements.** Real data is starting to land (D72/D73/D74 successes, D64 cron, D66 access-code failures). `/admin/security` is currently a flat 100-row table. Filter by action, severity, date range; pagination; CSV export of the filtered view.
3. Per-category bulk export filtering (D74 follow-on — easy add to `getResponsesForExport`).
4. Wide-format export pivot (D74 follow-on — alternative to long-format).
5. Per-version export labelling (when V2 launches — add `questionnaire_version` column).
6. Bulk invite for main study scaling (current flow is one-at-a-time).
7. Cross-variant analytics for main study (D73 enabled the foundation).
8. Rate-limit hardening on `/enter` (D66's best-effort in-memory → per-IP store).
9. D66 smoke cases 4 + 5 retroactive (invalid-code audit row check + resend rotation reveal).
10. D26 geo/IP/device capture (columns ready, capture unwired).

### PENDING SURA DECISION (yellow)

- **Main-study D66 defense decision (post-pilot).** Keep OTP-style for participants in main, or simplify? Depends on pilot UX feedback.
- **D74 follow-ons priority order.** Per-category filtering vs wide-format pivot vs streaming — order depends on what Sura's ATLAS.ti pipeline asks for first.

### PENDING SURA ACTION (red)

- Pilot monitoring + completion (read F1-F4 feedback rolling, watch for blockers from the 6 in-flight participants).
- ~~Pilot activation + launch~~ — DONE (7 invitations sent; pilot live).
- Main study planning (post-pilot, depends on feedback).

### Active pilot guardrails (DO NOT TOUCH while pilot live)

- `validate_invitation_token`, `validate_invitation_code` RPCs
- `/r/[token]`, `/enter`, `/consent` routes
- `invitations` table schema (additive columns fine; renames/drops NOT)
- Pilot questionnaire variants (active — destructive changes orphan invitations)
- Reminder cron logic (D72 just touched; first fires ~June 10 — name-decrypt path's first real exercise)
- Email template rendering layer (D70 + D71 + D72 just touched — let it bake under real send load; BOTH D70's CSS layer AND D71's `<br>` fallback are required cross-client)
- D73 feedback hub aggregation (let it bake; first non-trivial render happens on category #2's submit)
- D74 export hub (just landed — read-only across data, decrypts under owner-only gate; audit-logged)
- The 12 unused feedback question rows (researchers/donors/ngos × F1–F4 — intentional architecture for when those variants submit)

### Safe areas for new work

- D75+ work, admin UI improvements not touching active pilot surfaces, analytics, per-variant feedback breakdown (D73 foundation), audit-log UI enhancements (D76), rate-limit hardening on `/enter`, D26 capture wiring.

### §9 Latest applied migration — UNCHANGED

D70 → D74 added zero migrations. Counter remains at `20260602130000` (D69 — `invitations_redacted` adds `collection_mode`). Next migration is `>= 20260602130001`.

---

## 🟢 PILOT-READY STATE (2026-06-02) — read first

The platform is production-green at `karasneh-research.org`. **Zero active questionnaire variants.** All 4 pilot variants (`pilot_officials`, `pilot_researchers`, `pilot_donors`, `pilot_ngos`) and all 5 main variants (`main_researchers`, `main_donors`, `main_ngos`, `main_officials_jordanian`, `main_officials_syrian`) are in `draft`. Sura controls activation via Path A: Saeed flips `pilot_researchers` to `active` on her "ready to send" signal.

The newer historical body below (everything from § ⚠️ SESSION CARRYOVER 2026-05-24 onward) was last meaningfully refreshed 2026-05-31 — D65/D66/D67/D68/D69 closures were never appended into the prose sections. This top block is the chronological layer that catches up. Future-Saeed prefers layered append over rewrite; the historical body is intentionally left intact.

### Closed since the 2026-05-24 carryover

- **D63 (2026-05-31)** — Withdraw-response = owner-only soft delete (`responses.status` + structural CHECK + first-use of `alert` severity). Cross-cutting filter pass keeps withdrawn rows out of every aggregation.
- **D64 (2026-06-01, PR #3, 10 commits)** — Auto-reminders (7d/14d via `/api/cron/send-reminders`) + send-failure surface (amber chip on `/admin/invitations`); Path B (token plaintext at rest via `token_plaintext_encrypted`); `errorClass` bucket keeps Resend strings out of audit metadata.
- **D65 (2026-06-01)** — Admin login switched from clickable magic-link to 6-digit OTP code (Microsoft 365 Defender URL-prefetch defense). `/admin/callback` retained for backward-compat.
- **D66 (2026-06-02)** — Same prefetch defense for participant invitations. `access_code_encrypted` column + brute-decrypt scan RPC + `/enter` page + `/invitation-invalid` soft fallback. Fresh-claim stamps `access_code_used_at`; resumption unlimited (mirrors URL semantics). Best-effort in-memory rate limit (5/60s/IP) — friction not security. Migration 12003 was fix-forward.
- **D67 (2026-06-02)** — Per-category labels for the 4 pilot variants — i18n bug surfaced by D66 smoke ("Official — Pilot Reviewer" was rendering for all categories). `categoryLabel(category, t)` + `pilotBadgeLabel(category, t)` helpers + `PilotCategory` union in `lib/i18n.ts`. NGO AR = "منظمات غير حكومية".
- **D68 (2026-06-02, commit 9ea4774)** — Stripped "Pilot" wording from 7 participant copy surfaces + removed questionnaire badge entirely (Y3). Phase-agnostic copy serves both pilot and main going forward. Dead code retained per A2 carve-out (now closed in D69). Admin-side "Pilot" labels intentionally kept.
- **D69 (2026-06-02)** — Deferred cleanup batch: (a) D68 A2 dead code removed (`pilotBadgeX` keys, `pilotBadgeLabel` helper, `variantToPilotCategory` function — zero live consumers confirmed pre-edit); (b) `collection_mode` added to `invitations_redacted` view (migration `20260602130000`) — closes Task #55 audit note AND a latent runtime-undefined bug for readonly callers; (c) this TASK_STATE refresh.

### NEXT QUEUE (green — actionable, no decision needed)

- CSV export of pilot responses (admin convenience for analysis hand-off)
- Bulk invite for main study scaling (current flow is one-at-a-time)
- Cross-variant analytics (dashboards currently variant-scoped)
- Rate-limit hardening on `/enter` (D66's best-effort in-memory → per-IP store)
- Audit-log review UI surface (filter/search the existing `audit_log` table)
- D66 smoke cases 4 + 5 retroactive (invalid-code audit row check + resend rotation reveal)

### PENDING SURA DECISION (yellow)

- **D70 main-study category labels — re-evaluate if needed.** D68 already made labels phase-agnostic; D70 may be unnecessary. Decision: do main variants need per-category labels at all, or does the D68 copy already cover them?
- **Main-study D66 defense decision (post-pilot).** Keep OTP-style for participants in main, or simplify? Depends on pilot UX feedback.

### PENDING SURA ACTION (red)

- Pilot activation + launch (Saeed flips `pilot_researchers` to active on signal)
- Pilot monitoring + completion (read F1-F4 feedback rolling)
- Main study planning (post-pilot, depends on feedback)

---

## ⚠️ SESSION CARRYOVER (2026-05-24) — read first

### NEW WORKSTREAM: Self-service readiness (gates Saeed-removal)
Saeed-removal (ethics gate, "data accessible only to the researcher") has a HIDDEN
PREREQUISITE discovered this session: once Saeed is removed, Sura operates the
platform UI-ONLY (no code/DB). Every operation she needs across the two-stage study
must be a UI action first, or she's stranded (and recalling Saeed re-opens the access
the ethics gate closed). So: build Sura's self-service controls → Sura is independent →
THEN remove Saeed → THEN real data flows.

Study is TWO SEQUENTIAL STAGES with a learning loop:
  Stage 1 Pilot: activate 4 pilot variants → invite → collect → read F1–F4 feedback → close
  Between:       revise the draft MAIN variants from that feedback → proof
  Stage 2 Main:  activate mains → invite → collect → export → close

STATUS (2026-05-31): 4 OF 4 SELF-SERVICE LIFECYCLE-BLOCKERS DONE + PROVEN.
Export remains separate (Stage-2 hand-off deliverable, data-blocked on
real responses — not lifecycle-blocking for Stage-1 collection).
  ✓ Activate/Close (commit 7a1ae78) — server-action + buttons on /admin/
    questionnaires/[versionId]. Action machinery (owner-gate / audit /
    router.refresh / transition guards) end-to-end proven via the Team smoke
    test (same pattern). UI button FINAL CONFIRMATION 2026-05-31 — exercised
    on main_researchers v1 (revoke-invitation smoke setup) and the accidental
    pilot_officials flip during the same smoke. Button correctly flips status
    + the row updates in both cases. STANDING ITEM RETIRED.
  ✓ Structural admin guards (27da7dc) — Inv1 (no runtime owner-creation,
    42501) + Inv2 (last-owner protection, 23514). Proven via rolled-back
    11-case probe matrix pre-apply AND post-apply against live triggers
    (identical results). The load-bearing check is auth.jwt() IS NOT NULL —
    empirically verified across three contexts (postgres / authenticated /
    service-role); current_setting('request.jwt.claim.role') was ruled out
    because it returns NULL for both postgres AND service-role.
  ✓ Team mgmt (62cf136 + 473ec46) — /admin/settings/team owner-only;
    invites read-only supervisors via createUser → admins-INSERT → magic-
    link, with orphan-cleanup saga (createUser succeeded → admins INSERT
    failed → deleteUser undo → if THAT fails, warn-severity audit row
    "admin.invite.orphan" carries email + auth.users id, discoverable in
    /admin/security). deleteUser itself wrapped against unexpected throws.
    SMOKE-TESTED LIVE on prod 2026-05-26 (s.lubani@gmail.com): admins row +
    auth.users + correct audit attribution + branded email + readonly
    containment (nav-absent + route-level 307s on /admin/security + /admin/
    settings/team) + clean removal via status='removed' + auth.admin.
    deleteUser. Cleanup rehearsed the real Saeed-removal mechanism.
  ✓ #4 Revoke-invitation (commits baef0f3 + ca48e96 + 6981fd7 types regen)
    — three-op terminal kill: token_hash rotation (link dies) + status=
    'revoked' (terminal label) + is_locked=TRUE on non-submitted response
    (active session kicked; saved answers RETAINED). Block-then-confirm UI
    gate on in-progress responses (honest wording: "saved answers retained
    and visible to you, but they cannot add more or submit"). Post-rotation
    re-read closes the sub-second race between gate read and rotation. SMOKE-
    PROVEN on prod 2026-05-31 — Cases 1/2/4 pass against throwaway main_
    researchers v1 (Case 3 skipped, already_submitted ≡ resend's). Cleanup
    reversed via the 4-count residue gate (invs/resps/answs/qns all zero)
    then DB-direct re-draft — main_researchers state byte-identical pre/
    post. Decision D61. Audit residue: 3 × invitation.revoke (warn) + the
    version.activate/re-draft pair on main_researchers + the accidental
    pair on pilot_officials (truthful append-only, PII-free).
  ✓ #5 D64 Cluster A — Auto-reminders + send-failure surface
    (10 commits merged as PR #3 on 2026-06-01: e577fc0 STEP 1 reminder +
    send-failure migration → 9dbadcb STEP 2 types regen → 1f4dd02 STEP 3
    sentAt latent-bug fix → 4d78c86 STEP 4 reminder templates →
    bf21086 STEP 5 sendReminderEmail wrapper → 15225c1 STEP 6 caller-
    owned failure surface (4 wrappers + repo widen + chip) → 649d303
    STEP 6.5 token_plaintext_encrypted migration → d8fa1b5 STEP 6.6
    write sites + grep audit → 6f0ec6b STEP 7 cron route (Path B) →
    5a88c22 STEP 8 vercel.json daily noon UTC).

    PATH B LOCKED: reminders reuse the existing token (decrypt
    invitations.token_plaintext_encrypted at dispatch). Original
    invitation email's link STAYS ALIVE across the reminder cycle. The
    Vault-encrypted plaintext-at-rest model mirrors recipient_email_
    encrypted; blast radius bounded by the same key + service-role
    separation. Path A (rotate per dispatch) was rejected because the
    original link dying mid-pilot would surprise un-clicked recipients.

    SEND-FAILURE SURFACE: all 4 email wrappers widened to return
    EmailSendResult (discriminated union with errorClass:'send'|'config');
    callers own the column + audit writes. New helper lib/audit.ts
    logSystemEmailFailure for service-role contexts (cron + respondent
    submit fan-out). "send failed" amber chip on /admin/invitations
    clears automatically on next ok send. Caller-owned writes mirror
    D63 STEP 3 sentAt pattern.

    PII DISCIPLINE AT THE AUDIT BOUNDARY: error.message NEVER persisted
    (Resend strings can echo recipient). Only { invitationId, kind,
    errorClass } reaches audit_log metadata. console.error logs refCode
    + errorClass only. Verified live in Phase 4 smoke — audit metadata
    was exactly the 3-field bucket, no PII leak.

    SMOKE-PROVEN on prod 2026-06-01 (10 cases) — Phase 1 (a-f, h): cron
    fires, reminder1_sent_at stamps post-OK, token_hash UNCHANGED (Path B
    proven at DB), pre-D64 row excluded silently via plaintext-IS-NOT-NULL
    gate. Phase 2 (g): ORIGINAL invitation URL still works in incognito
    AFTER reminder fires; participant flow even bumped sent → opened with
    use_count 1/1 (link fully functional). Phase 3 (i): re-curl returns
    {sent:0, failed:0}, idempotency proven. Phase 4 (j): Option A
    (.invalid TLD) silently accepted by Resend with 200; pivoted to
    Option B (RESEND_API_KEY env swap + redeploy), failure path fired
    correctly with errorClass='send' + amber chip + audit metadata
    {invitationId, kind: 'reminder1', errorClass: 'send'}. Decisions D64.

    BONUS LATENT-BUG FIX during STEP 6: resendInvitationAction now has
    try/catch around sendInvitationEmail. Pre-D64, missing RESEND_API_KEY
    would crash AFTER token rotation (old link dead, action 500s). Fixed.

    Two follow-up observations (NOT blocking):
      (a) Resend silently accepts .invalid TLD recipients (returns 200).
          Async bounces don't surface to last_send_failed_at via the
          wrapper — only sync API rejections do. A future Resend-webhook
          integration would close that "looked sent but didn't arrive"
          gap. Out of D64 scope.
      (b) collection_mode missing from invitations_redacted (surfaced
          during D64 read-first, still in OTHER OPEN below). Severity:
          low; addressed on its own slow day. Doesn't block.

    See DECISIONS.md D64 + RUNBOOK "Auto-reminders + send failures (D64)"
    + the 5-template Email templates table (now includes reminder1 +
    reminderFinal alongside invitation, admin-invite, submission).

  ✓ #6 D65 — Admin login switched to 6-digit OTP code (PR #5 merged
    2026-06-02, commit 4fed581). O365 Defender URL-prefetch defense:
    audit log showed 8+ parallel verify_failed events per Sura login
    attempt; Defender was consuming Supabase's single-use token before
    she could click. The fix renders {{ .Token }} as TEXT in the Magic
    Link email instead of a clickable URL. /admin/login is now a
    two-state form (enter_email → enter_code); state 2 calls Server
    Action verifyOtpAction in lib/actions/admin-auth.ts (mirrors the
    proven /admin/callback cookie-write path). /admin/callback kept as
    legacy backward-compat for in-flight URL emails until the magic-
    link TTL drains. Sura verified post-merge — login worked first try.
    Decisions D65; RUNBOOK "Admin login — OTP code flow (D65)".

  ✓ #7 D66 — Participant URL prefetch defense via 6-digit access code
    (this branch, EOD 2026-06-02). Same vector as D65 but for the
    participant /r/[token] flow. Every invitation email now ships
    BOTH the URL AND a 6-digit access code; if a recipient's email
    scanner prefetches the URL, they enter the code at /enter
    instead. Three migrations: 12001 (columns + view recreate; view
    grew 21 → 22 cols, only the non-secret access_code_used_at
    surfaced), 12002 (RPC initial — strict single-use stamping on
    fresh-claim + resumption), 12003 (FIX-FORWARD — only fresh-claim
    stamps; resumption is unlimited as long as expires_at > NOW() +
    response non-submitted, mirroring URL token semantic). The
    strict-single-use semantic broke the legitimate recovery case
    (recipient loses cookie + tries to re-enter code) — reverted
    mid-build via the 12003 migration.

    TWO-SECRET SYMMETRIC MODEL: token_plaintext_encrypted (D64) +
    access_code_encrypted (D66). Both Vault-encrypted at rest. Both
    rotate together on resend. Both die together on revoke. Both
    reusable for the reminder cron (decrypt + interpolate per-iter
    scope). An attacker landing the code reaches the same threat
    ceiling as one landing the URL — symmetric, explicitly accepted
    in D66.

    LOOKUP via brute-decrypt scan over the candidate set
    (access_code_encrypted IS NOT NULL AND expires_at > NOW(),
    decrypt_pii each, compare to p_code). O(N) at pilot scale
    (sub-ms); explicitly NOT a SHA-256 hash column (6-digit codes
    are rainbow-table-trivial; would leak codes if hash ever
    surfaced).

    BRUTE-FORCE RESISTANCE LAYERED: (a) 1M entropy of 6-digit codes,
    (b) 60-day expires_at TTL, (c) audit-log durability via
    logFailedAccessCode("invalid_or_expired" | "rate_limited") —
    severity=warn, metadata=reason bucket only, NO p_code / IP / UA
    in metadata JSON (helper captures IP/UA on the row for forensics
    but stays a known-narrow shape), (d) max_uses budget gate
    (use_count >= max_uses returns empty). Per-IP in-memory rate
    limit (5 attempts / 60s / IP) is best-effort FRICTION not
    security — won't survive Vercel cold starts; documented in
    lib/actions/access-code.ts docstring + D66 DECISIONS. Future
    hardening = Vercel KV / Upstash if attack pattern emerges.

    ADMIN UI: post-create + post-resend success panels reveal
    URL + code in a stacked layout, each with its own copy button.
    Helper text under code: "Share with the recipient if their
    email service blocked the link above." Both shown ONCE per
    create/resend (neither recoverable from DB — encrypt_pii uses
    random IV; resend mints fresh values). Resend reveals both on
    BOTH the email-sent branch AND the loud-failure branch (Sura
    sees them every time, not just on send-failure).

    EMAIL TEMPLATE: new "access_code" SectionKey between personal
    and expiry, fine placement, requiredPlaceholders:['access_code']
    (structural guarantee Sura can't ship a template without the
    placeholder). One-line copy (HTML <p> collapses \n; one-line
    keeps HTML + plain-text byte-equivalent). EN/AR defaults
    bundled. Editor surfaces the new section like any other.

    DEPLOY: code lands first (PR), migrations 12001 + 12003 applied
    pre-merge (migration 12002 already on prod from the earlier
    failed-revision attempt; 12003 brings prod from strict to
    revised semantic). Forward-only: pre-D66 invitations stay NULL
    access_code; Sura's manual Resend mints + populates the column
    on the way through.

    BUILD: npm run build clean on the branch. Fix-up touched two
    file-paths that had RuntimeValues literals missing the new
    access_code field: the email-template editor preview page
    (app/admin/(protected)/settings/email-templates/[id]/page.tsx)
    and the editor's preview-render action (lib/actions/email-
    templates.ts). Also added access_code entry to SECTION_LABELS
    in components/EmailTemplateEditor.tsx (title + hint).

    Smoke pending — STEP 5 of the Phase plan.

    See DECISIONS.md D66 + RUNBOOK "Participant invitation URL
    prefetch defense (D66)" for the operator surface (post-
    create/resend admin reveal, participant /enter walkthrough,
    brute-force forensics queries, why-not-hash-column).

EXPORT (separate, NOT a self-service blocker):
  ✗ Export (Stage-2 deliverable — CSV / ATLAS.ti xlsx / executive report).
    DATA-BLOCKED on real responses; not lifecycle-blocking for Stage-1
    pilot collection, but blocks the final hand-off. Build when needed
    for the export step.

D22 EMAIL-TEMPLATE EDITOR — DONE (2026-05-26, branch email-templates,
commits 244965f schema + d1b564a code). Owner-only editor for the
participant invitation email (bilingual EN/AR), at /admin/settings/
email-templates. Editable per-section copy with whitelisted placeholders;
the magic-link URL is the SYSTEM-OWNED button href (never a placeholder),
structurally impossible to remove from the editor. Validation rejects
unknown / wrong-section / missing-required placeholders, persisting
nothing on failure — both rejection paths smoke-proven on prod
(refresh confirmed nothing persisted). Send-test sends to an owner-
chosen address with an INERT button (`?preview=invitation-email`, no
token minted — proven by zero imports of token-flow modules in the
test-send action), 30s cooldown, [TEST] subject + banner. Reset-to-
default deletes the row → renderer falls back to bundled defaults that
are byte-identical to the pre-D22 hard-coded invitation.ts (zero change
until edited). Sections JSONB reshape (migration 20260527120001):
applied to empty unused table, lossless, RLS/CHECK unchanged, types
regenerated identical to the hand-patch. Smoke-tested EN + AR send-test
on prod against real inboxes. Real-send rendering covered by transitivity
(same renderer call, only button_href differs — the existing token-mint
+ invitation-create flow was working pre-D22 and is untouched).

Two follow-ups noted:
  (a) STAGE 2: editors for the admin-invite + submission-notification
      emails. ✓ DONE + SMOKE-PROVEN (2026-05-31, decision D62). All 3
      platform-sent emails are now editor-managed (invitation bilingual,
      admin-invite EN-only, submission EN-only). Renderer generalised
      (renderInvitationEmail → renderEmailTemplate); invitation output
      byte-equivalent to pre-Stage-2; admin-invite accepts +1px font /
      -2px greeting margin as brand-unification; submission gains the
      branded card chrome + structural button guarantee (B(i)). Wrappers
      preserve caller signatures (zero ripple in admins.ts and
      notifications.ts). EN-only support via TemplateSpec.bilingual=false
      cascades through editor (AR column HIDDEN) + action validation.
      Commits: 28d0951 (migration id-widen) + 8a96e89 (code), PR merged
      as 55002f2. Smoke: 3 templates list, EN-only UI hides AR, branded
      chrome unified, placeholders substitute, [TEST] subject + banner +
      inert URL all confirmed. Leftover Stage 1 customization on
      Participant invitation cleared via UI Reset (exercised the
      resetTemplateAction path one more time). See STATUS "Email-
      template editor — Stage 2 done" block + DECISIONS D62 + RUNBOOK
      "Email templates" entry.
  (b) REVOKE-INVITATION — ✓ DONE + SMOKE-PROVEN (2026-05-31). See the
      "4 OF 4 SELF-SERVICE LIFECYCLE-BLOCKERS DONE" block above for the
      full ✓ entry (commits baef0f3 + ca48e96 + 6981fd7, decision D61,
      RUNBOOK "Revoking an invitation"). Shipped as a richer surface
      than the original gap sketch — three-op kill (rotation + status +
      is_locked), not a single column flip — because validate_invitation_
      token and getSession() don't check status, so a status-only "revoke"
      would have been theatre.

Design rule (still applies for follow-ups): expose SAFE ops (activate /
close / resend / revoke / add-readonly-admin), keep DANGEROUS ops OUT
(demote active→draft / unfreeze [guard blocks it], hard-delete responses).

### PARKED #1 — Pilot-counts-toward-main (Sura ↔ supervisors)
Sura is deciding with supervisors whether pilot SME responses fold into the main
dataset (they're SMEs who've effectively answered). Affects between-stages data
handling + the exact shape of the self-service controls. Don't build lifecycle/
content controls until resolved. Data-SAFETY care (backups, no-unfreeze) applies to
BOTH rounds regardless.

### NEXT QUEUE (post-D64)
The following clusters are queued, not blocked, awaiting Sura's pilot proofing to
wrap before they become urgent. Order is rough priority, not strict.

- **CSV export** — separate from the ATLAS.ti xlsx export (D18). Added during the
  D64 planning conversation as a Sura-readable raw-data surface for cross-checking
  aggregations or ad-hoc analysis outside ATLAS.ti. Format TBD (probably one row
  per response, columns for each question's answer + the response's metadata).
  Owner-only download path; respects the same withdraw-filter discipline as the
  rest of the analytics tier (D63).
- **Cluster B verify** — researcher notes + tags UI verification. The shipped
  3c-ii surfaces work; whether they're the SHAPE Sura wants for coding the pilot
  responses needs her sign-off post-pilot-collection. Likely small UX refinements
  (tag grouping, note templates, keyboard shortcuts for high-throughput coding)
  rather than structural changes.
- **Bulk invite** — currently invitations are one-at-a-time via the
  /admin/invitations/new form. For Stage 2 main collection (potentially dozens of
  invites in one sitting), a CSV-upload bulk path would save Sura time. Surface
  design TBD; needs to handle per-row PII encryption + ref_code generation +
  partial-failure semantics (some rows valid, some not).
- **Cross-variant analytics + funnel** — the dashboard reads one questionnaire
  variant at a time (or aggregates across all). For thesis-defense narrative,
  cross-variant comparisons (Officials vs Researchers, Jordanian vs Syrian) are
  likely useful. Same with a proper funnel view (sent → opened → started →
  submitted, broken down by category / nationality / time). Belongs in the
  analytics tier; post-Stage-1 pilot data is when this becomes actionable.

### D27 AUTOMATED BACKUP — COMPLETE (2026-05-27, all 4 steps, RESTORE-PROVEN)

Daily cron live at 03:00 UTC, encrypted blob lands in Cloudflare R2
(`yarmouk-backups` bucket, 30-day rolling lifecycle). Branch merged to main +
pruned. Restore-proven via the rehearsed procedure in RUNBOOK "Rehearsed
restore — CI-produced blob (proven 2026-05-27)".

  ✓ STEP 1 — backup_ro role (29a637b). Least-privilege, PROVEN Vault-blind
    (no vault usage/select, no role inheritance, not superuser; BYPASSRLS for
    complete dump of RLS tables). Password URL-safe hex, in password manager.
  ✓ STEP 2 — headless backup.sh env-branch (2fbb90e). `BACKUP_DB_URL` overrides
    `--linked`; output shape identical either way → existing restore proof
    transfers. `BACKUP_DB_URL` (backup_ro via shared/session pooler, port 5432,
    user backup_ro.trvxugvkesfcopwdtdey): PROVEN working.
  ✓ STEP 3 — workflow (dfa92e9 + 4e3bb04 + f0e921a, merge d547c43). Raw
    pg_dump 17 (NOT supabase db dump — needs Docker, flaky in CI). Encrypts
    with the SAME cipher/flags as scripts/backup.sh (byte-shape-compatible).
    Uploads to R2 via aws-cli + endpoint override + `BACKUP_S3_REGION=auto`
    (R2 idiom). All 7 GH secrets provisioned by Saeed; first dry-run from
    branch went green (post structural pg_dump-17 fix — absolute path
    `/usr/lib/postgresql/17/bin/pg_dump`, not PATH-based). 20.86 KB blob
    `yarmouk-20260526-1709.yarmoukbackup` landed in R2.
  ✓ STEP 4 — restore-proof (2026-05-27). Downloaded the CI blob from R2,
    decrypted with `openssl -pass file:~/.restore-proof.passphrase` (proved
    GH secret ≡ password-manager value), spun docker postgres:17 throwaway,
    pre-seeded REQUIRED stubs (`authenticated` role, `auth/vault/extensions`
    schemas, `auth.users` / `vault.decrypted_secrets` tables, `auth.uid()` /
    `auth.jwt()` / `auth.role()` functions — vanilla pg lacks them; without
    them ~50 RLS/GRANT errors silently skip). Schema apply: 1 benign error
    (`schema "public" already exists`). Data apply: 0 errors with
    `session_replication_role = replica` deferring the
    admins.id→empty-auth.users FK. Count diff JOIN-BY-NAME (not
    paste-by-line, which hits locale-collation false-mismatches on
    `response_tags`/`responses`): all 17 tables matched (98 rows across 6
    non-zero tables: admins=3, audit_log=19, email_templates=1,
    questionnaire_versions=9, questions=57, settings=9).

Procedure documented step-exact in RUNBOOK "Rehearsed restore" — the
emergency runbook a future-you (or Sura post-handoff) follows in a real
recovery. Stub SQL block + FK deferral + join-by-name diff all baked in.

Follow-ups parked (NOT blocking):
  (a) Verify R2 lifecycle rule actually purges objects after the 30-day
      window — one-off check ~30 days after first cron blob (~2026-06-26).
  (b) Stage 2 — add `recordings` Storage bucket to the dump when interviews
      start being recorded (the per scripts/backup.sh comment).

### OTHER OPEN
- Sura PROOFING the 4 pilot drafts via the preview (her gate; nothing activates until
  sign-off). All 4 pilots DRAFT + uninvitable.
- Activation is currently DB-only (UPDATE status='active'); no UI button yet — this is
  exactly what the self-service workstream addresses.
- D22 email-template editor: DONE 2026-05-26 (Stage 1, invitation) +
  Stage 2 DONE 2026-05-31 (D62, admin-invite + submission editors,
  commits 28d0951 + 8a96e89 merged as 55002f2). All 3 platform-sent
  emails are editor-managed. Revoke-invitation gap CLOSED 2026-05-31
  (D61, see "4 OF 4 SELF-SERVICE LIFECYCLE-BLOCKERS DONE" block above).
  Per-template BCC owner toggle + global override is the only un-built
  tail of D22 — not blocking; defer to post-launch.
- LIVE FINDING (surfaced by the admins-guards probe, 2026-05-26): Saeed
  (`salloubani@cybercorrelate.com`) is CONFIRMED still `role=owner, status=active` in
  prod — never cleaned up from his dev-bootstrap. Per ethics gate ("data accessible only
  to the researcher"), removal MUST land before real participant data. The right
  removal shape is **demote-to-readonly + status='removed'** (NOT DELETE — `audit_log`
  FK correctly protects his historical action attribution). Inv2 allows either; Sura
  stays active owner. Gated behind the self-service workstream completing so Sura isn't
  stranded the moment Saeed's role flips.
- AUDIT QUEUE — `collection_mode` missing from `invitations_redacted` (surfaced during
  D64 read-first, 2026-05-31; STILL OPEN post-D64 close 2026-06-01). The view created
  in `20260519170005_views.sql` lists 18 columns; `collection_mode` added by
  `20260523130001_collection_mode.sql` to the invitations base table was never
  appended to the view. The D64 STEP 1 view recreate (`20260601130001`) added 3
  new columns (`reminder1_sent_at`, `reminder_final_sent_at`, `last_send_failed_at`)
  but deliberately did NOT add `collection_mode` — out of D64 scope, tracked here
  to address on its own cycle. `getInvitation` for readonly admins routes through
  the view, then `rowToInvitation` casts to `DbRow` and reads `.collection_mode` —
  for readonly admins, that read returns `undefined` at runtime (TS is happy because
  of the cast). **Goal**: determine whether any readonly-admin UI/code path displays
  or depends on `response.collectionMode`, and what the runtime impact actually is.
  Discovery before fix — impact may be zero (no readonly UI consumer) or may matter
  (some surface silently mis-renders). The fix scope follows from the audit: trivial
  migration (add column to the view recreate) OR deeper (defensive undefined handling
  in mapper / UI). Severity: low — doesn't block anything.

---

# Task State — Handoff Snapshot

Last updated: PRODUCTION DEPLOYED + PROVEN LIVE (2026-05-23) at karasneh-research.org — auth (token_hash/verifyOtp), email both directions from verified domain, full respondent flow smoke-proven, true-empty. UI bilingual pass done (commit d87d1e1). Remaining before real participants: backups (unbuilt), Saeed-removal, invitation-email Arabic copy. See docs/STATUS.md Production Deployment.

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

**Whole-product backlog: see `docs/STATUS.md` ## What's Left** (tiered by what unblocks enrollment vs. analysis, 2026-05-23).

**Session 2b COMPLETE** (full public respondent flow), **3a COMPLETE** (admin auth), **3b COMPLETE** (invitations — 3b-i mint/list/create + 3b-ii email/resend), **3c-i COMPLETE** (responses list + detail — PII-redaction boundary), **3c-ii COMPLETE** (tagging + researcher notes — annotation layer), **question editor COMPLETE** (draft questionnaire content) — **Session 3 COMPLETE** — and the **admin dashboard + sidebar shell COMPLETE**, all verified live. 2b: invitation link → `/r/[token]` → landing → consent (name encrypted) → paginated questionnaire (EN/AR, autosave, resumption, nationality-gated, forward-lock + map) → server-side submit gate → terminal thank-you, re-entry blocked post-submit. 3a: magic-link/OTP sign-in via Supabase built-in email (signup locked down, D49), `(protected)` layout guard + `/admin/*` session-refresh middleware (D50), case-insensitive email matching (D51), `current_admin()`, Sura owner seed. 3b-i: `lib/tokens.ts` mint (D44), owner-gated invitation create (encrypt_pii via the authenticated client, one-time `/r/<token>` URL — D52/D53), invitation list (repo role-branch, non-PII columns), **admin-mutation audit from mutation #1** via `log_audit()` SECURITY DEFINER + `lib/audit.ts` (D54). 3b-ii: `buildInvitationUrl()` SITE_URL guard, send-at-create (optional, failure benign), `resendInvitationAction` (D56 response-aware rotation: submitted→block / in-progress→resume re-send work-preserved / none→fresh), bilingual email via Resend API (D55; EN final, AR→EN fallback). 3c-i: responses list (ref_code-keyed, identity-free, invitation context via the role-routed repo joined **in memory** — never a PostgREST embed onto a PII base table, which would leak ciphertext to readonly) + response detail (**null-driven redaction**: `ciphertext ? decrypt_pii : "Redacted"`, zero page-level role conditionals; `getVisibleQuestions` nationality-filtered + answers; consent verification; independent readonly banner). 3c-ii: tagging (create-or-pick inline, case-insensitive dedup backed by `tags_name_lower_key`, category required for new tags, idempotent apply; owner-write / supervisor-read) + researcher notes (owner-only, one-per-response upsert, **absent** for readonly) — both owner-gated + forbidden-audited + audited via `log_audit` (D54) with the note **body kept OUT of metadata** (chars only); write boundary proven at all three layers (UI / action / RLS) and the `rn_owner_select` fix verified via an owner-vs-readonly RLS contrast under `SET ROLE authenticated` (0 vs 1 rows). Question editor: draft-only bilingual EN+AR question CRUD (`lib/repos/questionnaires.ts` + `lib/actions/questions.ts` + `components/QuestionEditor.tsx` + `/admin/questionnaires` list & `[versionId]` editor) — owner-gated → draft-gated (`status==='draft'`, else `frozen`) → audited (D54, code+ids only, no text bodies); add / edit / delete-with-re-sequence / reorder; the D10 freeze made a **DB invariant** by the `questions_draft_only` trigger (migration 017) — proven at three layers (UI / action / trigger, `check_violation` 23514) and the readonly write-boundary at four (nav / redirect / action-gate / `q_owner_*` RLS `42501`). 8/8 (3a) + 6/6 (3b-i) + 5/5 (3b-ii) + 3/3 (3c-i) + 3/3 (3c-ii) + full question-editor smoke passed against the live DB (2026-05-20/21); production cleaned back to 0/0/0. Admin dashboard + sidebar shell: `lib/repos/dashboard.ts` null-safe non-PII aggregates (reads `invitations_redacted`, never the base table; status funnel; avg duration COMPUTED from `submitted_at−started_at` since `duration_minutes` is unpopulated; by-category; ref_code-only activity; at-a-glance) + `components/AdminShell.tsx` role-gated sidebar (Questionnaires owner-only) wrapped around the auth guard; dashboard smoke passed (empty=intentional, lifecycle-correct, readonly identity-free); **no migration** (read-aggregation). Migrations 013–017 applied (count → 17; **3b-ii and 3c-i shipped no migration**; **3c-ii shipped 016** — `rn_owner_select` + `tags_name_lower_key`; **question editor shipped 017** — `questions_draft_only` trigger). New deps: `zod` (3b-i), `resend` (3b-ii). **Polish + a11y sweep** (2026-05-21, no migration): root `<html lang>`/`dir` now reflect the active language via `getLang()` — `lang="ar" dir="rtl"` for Arabic respondents (a11y #8 fixed; was hardcoded `lang="en"`); display-only label helpers `categoryLabel()` (in `lib/repos/invitations.ts` — "NGOs" casing) and `variantLabel()` (in `lib/repos/questionnaires.ts` — questionnaire-variant labels without raw underscores), **enums unchanged**; `InvitationCreateForm` internal nav `<a>`→`<Link>`; accessible names added to three previously-nameless controls (researcher-note textarea, resend token-URL input, questionnaire answer field via `aria-labelledby`). Tracked forward in STATUS.md "Known Open Items": form-label `htmlFor`/`id` association sweep (soft a11y) + admin-lang isolation (needs a route-group root-layout split). **Response-submitted notifications** (2026-05-21, no migration): wired the seeded-but-unused `notifications` table for the submit event (owner-only) — `lib/repos/notifications.ts` + `lib/notifications.ts` (`notifyOwnersOfSubmission`, **structurally cannot throw**) + `lib/email/submission.ts` (identity-free, EN, reuses Resend conventions) + `lib/actions/notifications.ts` (owner-gated mark-read/mark-all, **not audited** per D54) + `components/NotificationsBell.tsx` (owner-only bell + unread badge + dropdown), hooked into `submitQuestionnaire` AFTER finalize / BEFORE `redirect()` as fire-and-forget. On submit, all active owners get an in-app row (**service-role INSERT, RLS-bypass** — the no-auth INSERT policy is by design; owner reads via `n_self_select`) + a best-effort email; the bell is **role-gated, not row-gated** (readonly skips both the layout fetch and the AdminShell render — RLS is identity-scoped, so a flipped owner's rows still match by id, but the role gate hides the bell). Full smoke green (NOTIF-1: **2 rows, one per active owner**, identity-free body + deep-link href; email graceful — `ok=true` to the deliverable Resend account address, `ok=false` to the non-account owner, **submit unaffected either way**, distinct `[notify]` logs; readonly no-bell/no-leak; cleaned to a **true-empty baseline** — 0 invitations/responses/answers/consent/notifications, both admins owner). **No migration** (table/RLS/indexes purpose-built in 2a); count stays 17, D-count stays D56. Tracked forward in STATUS.md: honor `notification_preferences` + a preferences UI (Session 5), shared `lib/email/resend.ts` extract (FROM/REPLY_TO duplicated — load-bearing for the Resend-domain pre-launch item), realtime push (post-launch).

**Notification preferences** (2026-05-23, no migration): the submission-notification toggles (submission_inapp / submission_email) are now load-bearing — previously drawn-but-fake (the fan-out ignored them, default-on). lib/repos/notifications.ts gains getActiveOwnersToNotify (resolves active owners + their two submission prefs; no-row = ON, enforced in app code via a default-true overlay, NOT the DB column default — a missing row means the default never fires) alongside the untouched getActiveOwners; lib/notifications.ts fan-out swaps to it and gates each channel per-owner (in-app skipped if submission_inapp=false, email if submission_email=false; a skip is silent — opt-out is not failure; never-throw contract + await-before-redirect preserved); lib/actions/settings.ts adds owner-gated getMySubmissionPrefs / saveMySubmissionPrefs (upsert keyed on admin_id PK, writes only the two surfaced columns so the other ten keep DB defaults on insert / untouched on update; admin_id always server-derived from getCurrentAdmin, never client input; not audited per D54, same as mark-read); /admin/settings owner-gated page (mirrors the questionnaires gate) + components/SubmissionPrefsForm.tsx (save-on-flip, optimistic with loud-failure revert — a toggle never shows a state the server rejected) + AdminShell.tsx owner-only Settings nav link (last in the owner section). Live-smoked via a throwaway direct fan-out call (deleted, never committed): with the account owner's prefs at submission_inapp=false and the other owner at no-row, a single submit produced exactly one in-app row (the no-row owner — bell fired) and zero for the opted-out owner (bell suppressed), both emails attempted (one delivered, one the known test-sender ok=false), never-throw held; DB cleaned to true-empty (0/0/0/0). No migration (notification_preferences table + np_self_* RLS already shipped in migration 004); count stays 17, D-count stays D56 — no new decision (no-row=ON is an app convention). Verified by construction, NOT live-smoked (flagged honestly): the readonly→/admin/settings redirect (mirrors the proven questionnaires owner-gate, but no readonly flip this session) and the loud-failure revert (UI logic, not exercised against a forced save-failure). Tracked forward: only the two submission toggles are surfaced — the other ten preference types are DB columns with no UI until their notification features exist; the requireRole owner-gate extraction (§12) now has two more inline call sites wanting it; shared lib/email/resend.ts extract still pending (load-bearing for the Resend-domain pre-launch item).

**Recordings storage + upload/playback** (2026-05-23, migration 018): owner-only audio upload against a response, private-bucket storage, lazy signed-URL playback — audio as interview evidence; the manually-typed answers remain the data (D15). Migration 018 added the security floor: recordings_obj_owner_all RLS on storage.objects (scoped to bucket_id='recordings', owner full / readonly none — the predicate is load-bearing since storage.objects is shared across buckets) + the recordings_require_consent BEFORE INSERT/UPDATE trigger on recordings (refuses audio against a non-consenting OR unverified-consent response; check_violation 23514; SECURITY DEFINER, same pattern as questions_draft_only/017). Both boundaries proven LIVE before any app code: consent trigger 3/3 (false/true/no-row, transactional rollback probe) + storage role-flip 4/4 (owner write+read PASS, readonly write 42501 + read zero-rows, with current_admin_role() INFO rows confirming the flip resolved owner/readonly — not a wrong-reason pass). App layer (all authenticated client — the proven RLS is load-bearing on the real path, never service-role): lib/repos/recordings-storage.ts (upload/delete/sign), lib/actions/recordings.ts (uploadRecordingAction: owner-gate + forbidden-audit + consent pre-check + orphan-safe cleanup on insert-refusal; getRecordingPlaybackUrlAction: lazy 2h signed URL, owner-gate + forbidden-audit; both audited per D54, FILENAME KEPT OUT of audit metadata — could carry a participant name), components/RecordingsSection.tsx (consent-aware upload + lazy per-row playback), and the response detail page wiring (upload shown only when audio_consent=true; "not consented" message when false; absent when no consent record). Existing recordings table/view/repo (002/005) were already transcription-ready — transcription/mapping columns (transcript_*, substitution_key, status enum) untouched, reserved for the backlog feature. Live-smoked end-to-end (browser, owner): upload (1.4MB mp3) → bucket object + recordings row (status audio_only, correct uploaded_by) + recording.upload audit (recordingId+sizeBytes, NO filename) all verified at the data layer; lazy playback works; negative case confirmed (audio_consent=false response shows the declined message, no upload control); cleaned to true-empty incl. the bucket object. Migration count → 18; decisions → D57 (private recordings bucket: dashboard-provisioned 50MB audio-MIME, NOT migration-managed — like Vault secrets), D58 (consent-gate trigger as DB invariant), D59 (upload via Server Action for v1 — see blocker). PRE-LAUNCH BLOCKER (load-bearing): the Server-Action upload transport works locally via next.config.ts serverActions.bodySizeLimit='50mb', but Vercel caps serverless request bodies at 4.5MB — real interview audio will be rejected at the platform layer in production. Rework to a direct-to-Storage signed-upload (browser → bucket, bypassing the Server Action body) before launch; the bucket/RLS/consent-trigger/row-model/playback/audit all carry over — only the upload transport (uploadRecordingAction + the FormData call) changes. Tracked in STATUS.md pre-launch list. Op note: storage.objects can NOT be deleted via SQL (storage.protect_delete trigger raises 42501) — use the Storage API (.remove(), which deleteRecordingObject already does); any future cleanup/backup script must use the API, not SQL. Deferred: audioDurationSeconds extraction (the <audio> element exposes duration client-side — easy follow-up; column stays null) and the whole transcription/mapping backlog feature.

**Collection_mode marker** (2026-05-23, migration 019): a `collection_mode` enum (`self_completed` | `interview`) on invitations, NOT NULL default `self_completed`, inherited by the response via its invitation FK (deliberately NO column on responses). Marks HOW a response was collected. ORTHOGONAL to audio_consent: collection_mode = how gathered (self vs interview), audio_consent = whether recorded — an interview may be unrecorded. The interview workflow (D-context): Sura conducts the interview offline with a recorder, returns to the office, logs in as owner, creates an invitation marked `interview` (does NOT email it), opens the `/r/<token>` link HERSELF, marks consent (incl audio_consent), fills the answers via the EXISTING respondent flow, and uploads the audio on the admin response page. CRITICAL DESIGN DECISION (so a future session does not rebuild it): we deliberately did NOT build a separate admin answer-entry UI. The respondent flow already collects answers; an interview is just an invitation the researcher fills via its own link. collection_mode exists ONLY to distinguish the resulting data (dashboards/exports/the "Interview" list chip) — not to gate a parallel write path. (We explored owner answer-entry with provenance/freeze/audit and abandoned it once the workflow was clear: answers go through the respondent path regardless of who types them, so per-answer provenance would be inaccurate anyway — the honest marker lives on the invitation.) App: collection_mode through the invitations repo (type + mapper + create insert, default self_completed; `collectionModeLabel()` helper) and create action (zod `.default('self_completed')`, create audit metadata; create-only — NOT editable via resend, since it's a fixed property of how the invitation is run); a create-form select (default self-completed, independent of send-email); shown on the response detail page; an "Interview" chip on interview rows of the responses list (self_completed unlabelled). Decisions → D60 (collection_mode enum, create-only, marker-not-write-path). Smoke-verified: create→DB→display round-trip (interview shows on detail + list chip) + default path (omit → self_completed); DB cleaned true-empty.

**Dev-admin note:** salloubani@cybercorrelate.com is seeded live as a SECOND owner DURING DEVELOPMENT ONLY. Per Sura's decision (2026-05-23): Saeed stays while building, but is REMOVED before any real participant data goes in — so the consent form's "accessible only to the researcher" (singular) stays true at real-enrollment time. Removal is part of the go-live sequence, NOT before deploy (the account is needed during dev). This SUPERSEDES the earlier 'permanent 2nd researcher' framing (docs/STATUS.md line ~235 now reconciled to match).

**Next: Session 4 (analytics + exports)** — **Session 3 COMPLETE**, and **Session 6 recordings + collection_mode SHIPPED** (recordings upload/playback migration 18 D57-D59; collection_mode marker migration 19 D60; both smoke-verified 2026-05-23). The **admin dashboard + sidebar shell** is live. Session 4 is the thesis-analysis deliverable: five analytics dashboards over real SQL, the **ATLAS.ti `.xlsx` export** (3c-ii's tags feed the starter codes, D19), PNG/PDF/Word exports, and the Executive Progress Report. **Session 4 is deferrable** — the core operator build (collect → view → code → edit instrument → monitor) is well-advanced. Still pending from 3b: seed the two supervisor admins (readonly) once emails are known (also unblocks the `invitation.*.forbidden` audit rows). Transcription is still pending — only the recordings STORAGE shipped, not transcription (the Sura Whisper auto-vs-manual question is still open). Not yet scoped; deliberate planning pass first.

**Nothing is in flight.** No background processes, no timers, no scheduled work. The repo is in a clean state: working tree matches `origin/main`.

---

## 3. Production state (live)

- **Repo**: `github.com/saeedalloubani/yarmouk-platform` (private)
- **Supabase project ref**: `trvxugvkesfcopwdtdey`
- **Supabase region / tier**: free tier (default Supabase placement)
- **Branch protection** on `main`: force-push blocked, deletion blocked. Direct pushes still allowed (solo phase).
- **Vault state**: `pii_key_v1` exists. Verified `decryptable=true`. Backed up in Owner's password manager as `Yarmouk — pii_key_v1 (active)`.
- **Migrations applied**: all 19 (see §5).
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

## 5. Migrations applied (19 total)

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
| `…015_log_audit.sql` | Audit (3b-i): `log_audit()` SECURITY DEFINER granted to authenticated — bypasses audit_log's authenticated-INSERT restriction while the trigger snapshots the acting owner (not 'system'). Pure INSERT, no actor params (D54). |
| `…016_tighten_researcher_notes_and_tag_dedup.sql` | Annotation layer (3c-ii): replaces `rn_admins_select` (owner+readonly) with `rn_owner_select` (owner-only SELECT on `researcher_notes` — closes a readonly note-read leak found in live `pg_policies`); adds `tags_name_lower_key` UNIQUE INDEX on `lower(name)` for case-insensitive tag dedup (case-sensitive `UNIQUE(name)` retained). Policy + functional index only → no type regen. |
| `…017_questions_draft_only.sql` | Question editor (Session 3): `questions_draft_only` BEFORE INSERT/UPDATE/DELETE trigger — refuses any question mutation whose parent version isn't `draft` (raises `check_violation` 23514). Makes the D10 freeze a DB invariant (fires regardless of connection role). SECURITY DEFINER + locked search_path; `COALESCE(NEW,OLD)`. Trigger + function only → no type regen. |
| `…018_recordings_storage_and_consent_gate.sql` | Recordings (Session 6): `recordings_obj_owner_all` RLS on `storage.objects` (owner full / readonly none, scoped to bucket_id='recordings') + `recordings_require_consent` BEFORE INSERT/UPDATE trigger (refuses audio against non-consenting/unverified response, check_violation 23514). Bucket itself is dashboard-provisioned, not in this migration (D57). |
| `…019_collection_mode.sql` | Collection mode (Session 6): `collection_mode` enum (`self_completed` \| `interview`) + NOT NULL DEFAULT `self_completed` column on `invitations`. Pure enum + column add — no RLS/trigger/function (D38/D39 N/A). Type regen ran. Marks self-completed vs interview responses; orthogonal to audio_consent (D60). |

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
│   │   ├── callback/route.ts          token_hash + verifyOtp → /admin (3a; switched from ?code= PKCE in prod)
│   │   ├── unauthorized/page.tsx      Authenticated-non-admin notice + sign out (3a)
│   │   └── (protected)/               Guarded subtree (login/callback/unauthorized sit OUTSIDE)
│   │       ├── layout.tsx             Auth guard (getUser → getCurrentAdmin → redirect; 3a/D50) → renders AdminShell sidebar (dashboard)
│   │       ├── page.tsx               Overview dashboard — KPI funnel / by-category / activity / at-a-glance (dashboard)
│   │       ├── invitations/           Invitations admin (3b-i)
│   │       │   ├── page.tsx           List — repo role-branch, non-PII columns, owner "+ New" + Resend column (3b-i/3b-ii)
│   │       │   └── new/page.tsx       Create — owner-asserted; loads active versions; renders the form
│   │       ├── responses/             Responses admin (3c-i)
│   │       │   ├── page.tsx           List — ref_code-keyed, identity-free, in-memory join via role-routed repos (3c-i)
│   │       │   └── [id]/page.tsx      Detail — null-driven PII redaction; answers; consent verify (3c-i) + tags (both roles) + researcher-notes (owner-only) annotation (3c-ii)
│   │       └── questionnaires/        Question editor — OWNER-ONLY (Session 3)
│   │           ├── page.tsx           Versions list — drafts editable; active/closed frozen, view-only
│   │           └── [versionId]/page.tsx  Editor for a draft; read-only frozen view otherwise
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
│   ├── QuestionnaireWizard.tsx        Client wizard — autosave, flush-on-boundary, map (2b-3)
│   ├── InvitationCreateForm.tsx       Client create form — send-now checkbox + one-time token URL (3b-i/3b-ii)
│   ├── InvitationResendButton.tsx     Client per-row resend island — loud-failure panel (3b-ii; D56)
│   ├── ResponseTagEditor.tsx          Client tags island — chips both roles; owner add/remove (canEdit) (3c-ii)
│   ├── ResearcherNoteEditor.tsx       Client note island — owner-only textarea + upsert (3c-ii)
│   ├── QuestionEditor.tsx             Client draft editor — bilingual EN+AR CRUD + up/down (Session 3)
│   ├── AdminShell.tsx                 Client sidebar shell — role-gated nav (Questionnaires owner-only) + owner-only header bell (dashboard/notifications)
│   └── NotificationsBell.tsx          Client owner-only bell — unread badge + dropdown, mark-read/all (notifications)
├── lib/
│   ├── auth.ts                        getCurrentAdminRole + getCurrentAdmin(id,name,role) — RPC wrappers (3a)
│   ├── audit.ts                       logAudit() — wraps log_audit() RPC; every admin mutation calls it (3b-i; D54)
│   ├── tokens.ts                      mintInvitationToken() (D44) + buildInvitationUrl() SITE_URL guard (3b-i/3b-ii)
│   ├── cookies.ts                     getLang/setLang + getSession/setSession/clearSession(+Cookie) (2b-2/2b-3; D41)
│   ├── i18n.ts                        Canonical Lang + translations + LANG_PICKER_LABELS (2b-2/2b-3)
│   ├── notifications.ts               notifyOwnersOfSubmission() — fire-and-forget owner fan-out; never throws (notifications)
│   ├── email/
│   │   ├── invitation.ts             sendInvitationEmail() via Resend API; EN final, AR→EN fallback (3b-ii; D55)
│   │   └── submission.ts             sendSubmissionEmail() — owner-facing, identity-free, EN; reuses Resend conventions (notifications)
│   ├── actions/
│   │   ├── setLang.ts                 Server Action wrapping setLang for client use (2b-2)
│   │   ├── consent.ts                 submitConsent — validate + encrypt_pii + insert (2b-3)
│   │   ├── answers.ts                 saveAnswer (autosave + opened→started) + submitQuestionnaire (2b-3)
│   │   ├── auth.ts                    signOut Server Action (3a)
│   │   ├── invitations.ts            createInvitationAction (+send-at-create) + resendInvitationAction (3b-i/3b-ii; D56)
│   │   ├── tags.ts                    addTagToResponse / removeTagFromResponse — owner-gated + audited (3c-ii)
│   │   ├── notes.ts                   saveResearcherNote — owner-gated + audited, body out of metadata (3c-ii)
│   │   ├── questions.ts               create/update/delete/move — owner+draft gated + audited (Session 3)
│   │   └── notifications.ts           markNotificationRead/markAll — owner-gated, not audited (notifications)
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
│   │   ├── answers.ts                 Public-flow getAnswersMap/getAnsweredQuestionIds/upsertAnswer (2b-3)
│   │   ├── responses.ts               Admin non-PII reads (list/get + answer counts/details); no role branch (3c-i)
│   │   ├── tags.ts                     Non-PII tags/response_tags reads + find-or-create + apply/remove (3c-ii)
│   │   ├── notes.ts                    Non-PII researcher_notes get + upsert; owner-only via RLS (3c-ii)
│   │   ├── questionnaires.ts           Admin version list + question reads/writes (editor; authenticated client) (Session 3)
│   │   ├── dashboard.ts                 Null-safe non-PII dashboard aggregates (reads invitations_redacted) (dashboard)
│   │   └── notifications.ts             list/unreadCount/create/markRead/markAll/getActiveOwners; auth read + service-role write (notifications)
│   ├── exports/                       (empty; Session 4 export tooling)
│   └── encryption.ts                  NOT created — consent action calls admin.rpc("encrypt_pii") directly (one call site)
├── supabase/
│   └── migrations/                    18 timestamped migration files (see §5)
└── docs/
    ├── SCHEMA.md                      Canonical data model
    ├── DECISIONS.md                   D1-D59 decision history with rationale
    ├── CONVENTIONS.md                 TypeScript/SQL/Git/migration conventions
    └── STATUS.md                      Session-by-session build status + Notes
```

---

## 7. Decisions register (D1-D60)

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

**Session 3b-i (D52-D54)**
- D52: ref_code is free-text (format-guided); `UNIQUE` is the duplicate guard; auto-gen deferred
- D53: plaintext invitation token surfaced exactly once on create; never stored/logged/in a URL (only the SHA-256 hash persists)
- D54: admin mutations audited via SECURITY DEFINER `log_audit()` (granted to authenticated; trigger snapshots the acting owner, not 'system'); refusals audited too

**Session 3b-ii (D55-D56)**
- D55: app invitation emails via the Resend API directly (resend SDK), separate from Supabase auth SMTP; EN final, AR→EN fallback (pre-launch: Sura's Arabic + domain verification)
- D56: resend = response-aware token rotation — submitted→block, in-progress→resume re-send (work preserved), none→fresh re-send; old link dies on rotation; email-failure loud surface

**Recordings + collection_mode, Session 6 (D57-D60)**
- D57: private `recordings` Storage bucket — dashboard-provisioned (50MB, audio-MIME allow-list), NOT migration-managed (like Vault secrets, watch-out #7)
- D58: recording↔consent enforced as a DB trigger (`recordings_require_consent`), not app convention — refuses audio against non-consenting/unverified response
- D59: v1 audio upload via Server Action (50MB local bodySizeLimit); direct-to-Storage rework deferred to pre-launch (Vercel 4.5MB body cap)
- D60: collection_mode marker (`self_completed`|`interview`) on invitations, NOT NULL default self_completed, inherited by response via FK; create-only (not editable via resend); a DATA MARKER not a write-path gate — deliberately NO separate admin answer-entry UI (interviews filled via the respondent link); orthogonal to audio_consent

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
- Migration files: `YYYYMMDDHHMMSS_name.sql`. Latest applied: `20260602130000` (D69 — `invitations_redacted` adds `collection_mode`); the Session-1 batch is `2026051917000{1..17}`. Next migration is `>= 20260602130001`.
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
10. **Email resend AND revoke share the token-rotation-as-kill primitive** (since plaintext is never stored). Mint a new plaintext, hash it, UPDATE `invitations.token_hash` — the old link stops working immediately. Resend (D56) keeps the new plaintext + emails it; revoke (D61) discards it (no reissue). Both actions' header comments + RUNBOOK "Revoking an invitation" document the mechanic; the UI confirm dialogs warn the user that the magic link will stop working. (Task #11 retired 2026-05-31 — see section 13.)
11. **`CREATE OR REPLACE FUNCTION` can't change return type.** Adding/removing/reordering a `RETURNS TABLE` column (or changing a scalar return type) is rejected at push time with SQLSTATE 42P13. Use `DROP FUNCTION IF EXISTS …(exact-arg-types); CREATE FUNCTION …` + restate REVOKE/GRANT. Check `pg_depend` first to confirm no dependents. Body-only changes still use `CREATE OR REPLACE`. (D45, caught on migration 012.)
12. **Redaction is at the VIEW layer — never PostgREST-embed a PII base table.** Readonly admins keep a base-table SELECT policy on the PII tables (`invitations_readonly_select` etc.) — that policy is what lets the `security_invoker` redacted views return rows. A PostgREST embed like `responses.select("*, invitations(...)")` resolves against the **base** `invitations`, not `invitations_redacted`, handing readonly the ciphertext PII. Always fetch PII context (invitation/consent identity) through the role-routed repos (`lib/repos/{invitations,consent}.ts`) and join in memory by id. (Session 3c-i.)
13. **A redacted view doesn't cover owner-ONLY tables — they need an owner-only RLS SELECT.** `researcher_notes` shipped with `rn_admins_select` (owner+readonly SELECT, from migration 004), so readonly supervisors could read note bodies via direct PostgREST even though the UI hid the section — found by reading live `pg_policies`, not the migration source. Owner-only surfaces need an owner-only SELECT policy (migration 016's `rn_owner_select`). **Verify such a fix with an owner-vs-readonly contrast under `SET ROLE authenticated`** (RLS enforced; set `request.jwt.claims` so `current_admin_role()` resolves per-admin) — NOT as postgres/service-role, which bypasses RLS and shows the row in both cases, masking the bug. (Session 3c-ii.)
14. **Methodological invariants belong as DB triggers, not app convention.** The D10 question-freeze (don't edit a question once responses exist) was convention-only until the `questions_draft_only` BEFORE INSERT/UPDATE/DELETE trigger (migration 017) made it structural: it refuses any mutation whose parent version isn't `draft` (`check_violation` 23514), and a BEFORE trigger fires regardless of connection role — editor, direct PostgREST, privileged console, future script. An edited-after-answer question silently corrupts the analysis, so this protects research validity, not just data shape. Verify such a guard FIRES (not just parses) with a transactional probe: UPDATE *and* DELETE on a frozen row both refused, an allowed (draft) row still works, all rolled back. (Session 3 — question editor.)

---

## 12. What's next: Session 4 (analytics + exports)

**SUPERSEDED: see `docs/STATUS.md` ## What's Left (2026-05-23)** — the canonical, tiered whole-product backlog. The session-numbered framing below predates the production deploy (recordings/Session-6 already shipped); kept for historical context.

**Not yet scoped.** User wants a deliberate planning pass before implementation. **Session 3 is COMPLETE** — 3a (admin auth), 3b (invitations — 3b-i + 3b-ii), 3c (responses + detail, tagging + researcher notes), and the question editor (draft-only bilingual question CRUD; the D10 freeze made a DB invariant by the `questions_draft_only` trigger — see §11 watch-out 14) — all see §2. The **admin dashboard + sidebar shell** also shipped (operator cockpit; `lib/repos/dashboard.ts` null-safe non-PII aggregates over `invitations_redacted` + responses/answers/tags; `components/AdminShell.tsx` role-gated nav; no migration). Next is **Session 4 (analytics + exports)** — the thesis-analysis deliverable:

- **Analytics dashboards** — the five views (per-question pivot, themes/tags, timeline, demographics, pilot-feedback hub) over real SQL.
- **ATLAS.ti `.xlsx` export** — Survey-Import format (D18); 3c-ii's tags become starter codes (D19). Plus PNG/PDF/Word exports per dashboard and the Executive Progress Report.
- **Carried from 3b:** seed the **two supervisor admins** (readonly) once emails are known — migration row + dashboard auth.users identities (mirror the 3a Sura bootstrap); this also unblocks observing the `invitation.*.forbidden` `warn` audit rows fire (a real readonly account is needed to trigger them).

Later: overview dashboard (real KPI queries), comms/owner-only (Session 5), recordings/import/backup (Session 6), go-live (Session 7). **v1.1 post-launch:** create-questionnaire-variant UI (new variant enum value(s) via migration + create-draft-version form) — see `docs/STATUS.md` "v1.1 / Post-launch backlog".

**Note on `lib/encryption.ts`:** still NOT created — `encrypt_pii` has two call sites (consent action → service-role admin client; invitation create → authenticated owner client); `decrypt_pii` has two (resend action + response detail page, authenticated owner client). The question editor added NO encrypt/decrypt sites (questions are non-PII). Still deferred until a third decrypt site appears or the local `decryptPii` helper needs reuse.

**Owner-gate helper — extraction now begun:** the question editor introduced a local `requireOwner()` helper inside `lib/actions/questions.ts` (owner check + `*.forbidden` warn-audit + draft gate is separate) — the first real factoring of the pattern that create / resend / addTag / removeTag / saveResearcherNote each still inline. The anticipated `requireRole`-style helper in `lib/auth.ts` would unify all action files; do it when convenient (Session 4 actions will want the same gate).

When starting the next session, expect the user to first ask for a scope-narrowing pass (like every prior session). Don't dive into implementation without explicit scope agreement. The established per-file rhythm: decisions surfaced → draft shown → user redlines → save → typecheck/lint/build green → commit; separate commits for separate concerns; deferred doc items batched; probe the live DB before encoding assumptions into migrations.

---

## 13. Open tasks (carried forward)

**SUPERSEDED: see `docs/STATUS.md` ## What's Left (2026-05-23)** for the current canonical backlog; the items below are the older task-list carryovers.

These exist in the task list and are scoped for future sessions:

- **Task #9** — Remind Owner to connect Vercel + set Node 24 in project settings before any deploy. Not yet wired to Vercel; will surface when we approach Session 7 (or earlier if Owner wants preview deploys).
- ~~**Task #11** — Session 4 admin docs: "Resend invitation" requires token rotation. Document in the Invitations admin UI as user-facing notice.~~ **RETIRED 2026-05-31** at revoke-invitation close-out. Token-rotation-as-kill is documented in the action header comments (`lib/actions/invitations.ts` for both `resendInvitationAction` D56 and `revokeInvitationAction` D61) + the migration comment + RUNBOOK "Revoking an invitation". The UI text in `InvitationResendButton` / `InvitationRevokeButton` confirm dialogs ("the magic link will stop working") is the load-bearing user-facing surface; no separate /admin notice needed.

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
