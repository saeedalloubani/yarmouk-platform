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
