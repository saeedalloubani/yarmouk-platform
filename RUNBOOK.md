# Operations Runbook

Manual steps a human runs outside the codebase — Vault key setup, key rotation, disaster recovery, admin auth bootstrap. Migrations and scripts handle everything else. Decision rationale for these operations lives in `docs/DECISIONS.md` (D36 covers the Vault model; D4 covers what's encrypted and why; D49/D50/D51 cover admin auth).

## Admin auth bootstrap (Session 3a)

> **D65 update (2026-06)**: the Supabase **Magic Link** email template now renders a **6-digit OTP code as text** instead of a clickable URL. Sign-in flow is: `/admin/login` → enter email → state transitions to "enter the code we sent" → type the 6-digit code → land on `/admin`. The legacy URL-based `/admin/callback` route still resolves any in-flight emails sent before the template change (backward-compat window ≈ token TTL, ~60 minutes). See "Admin login — OTP code flow (D65)" below for the new procedure + the audit-evidence pattern that drove the switch. The dashboard bootstrap steps below (signups disabled, pre-create identity, redirect URLs) are unchanged.

Migrations seed the `admins` allow-list **row** (app-level role data), but do NOT create Supabase Auth identities. Provision those by hand in the dashboard. Per D49, signup is locked down — only pre-created identities can ever sign in.

**One-time dashboard steps:**

1. **Disable signups.** Authentication → Sign In / Providers → turn **"Allow new users to sign up" OFF**. (Belt-and-suspenders with `shouldCreateUser:false` in the login code.)
2. **Pre-create the admin identity.** Authentication → Users → **Add user** → `sjkarasneh24@eng.just.edu.jo`, **auto-confirm**. Dashboard "Add user" bypasses the signup toggle, so step 1 and step 2 are order-independent — what matters is that the user **exists before first login** (with `shouldCreateUser:false`, login can't create it). Supervisors (two readonly admins) are added the same way in Session 3b once their emails are known, and seeded into `admins` by that session's migration.
3. **Redirect URLs.** Authentication → URL Configuration → Redirect URLs → add `http://localhost:3000/admin/callback` and `https://karasneh-research.org/admin/callback` (plus the Vercel preview URL if previews are used).

After these: `npm run dev`, go to `/admin/login`, enter the email, click the magic link → `/admin/callback` exchanges it → `/admin` shows "Signed in as Sura Karasneh (owner)".

**PKCE fallback (only if the magic link fails at `/admin/callback`):**

The default email template uses a `?code=` link that the callback exchanges via `exchangeCodeForSession`. `@supabase/ssr` stores the PKCE code-verifier in a cookie shared with the server callback; if that cookie isn't present for some flow, the exchange fails and the user is bounced to `/admin/login?error=auth`. The fix (no code-verifier needed):

1. Authentication → Email Templates → **Magic Link**: change the link to
   `{{ .SiteURL }}/admin/callback?token_hash={{ .TokenHash }}&type=email`
2. In `app/admin/callback/route.ts`, read `token_hash` + `type` and call
   `await supabase.auth.verifyOtp({ type, token_hash })` instead of `exchangeCodeForSession(code)`.

Build/keep the code-exchange path first; switch only if smoke fails. (Also noted in the callback route comment.)

## Admin login — OTP code flow (D65)

D65 (2026-06) replaced the clickable magic-link with a **6-digit OTP code rendered as text in the email body**. Microsoft 365 Defender / Outlook was prefetching URLs in inbound emails (link-scanning for malicious destinations) and consuming Supabase's single-use tokens before Sura could click. Audit log evidence: **8+ parallel `verify_failed` events** per single login attempt to `sjkarasneh24@eng.just.edu.jo`. A URL-less email defeats the prefetch.

### The new flow (what Sura sees)

1. Go to `/admin/login`.
2. **State 1 (enter_email)**: type email address → click **Send sign-in code**.
3. The page transitions to **State 2 (enter_code)** showing "Check your email. We sent a 6-digit code to *<email>*. Enter it below."
4. Check inbox. The email body now reads (something like): *"Your sign-in code is: **123456**. Expires in 60 minutes."* — no clickable link to consume.
5. Type the 6 digits into the code field → click **Verify code**.
6. On success: land on `/admin` authenticated.
7. On failure (wrong code, expired, or not an authorized email): inline error "Invalid or expired code. Try again or request a new one." — stay on State 2. Click **Resend** to get a fresh code, or **Use a different email** to go back to State 1.

The State 2 transition fires **regardless of whether the email is authorized** (no-enumeration, D50). If the email isn't in the `admins` allowlist, no code is issued and verification will fail with the same generic error.

### Supabase email template (Studio side)

This is a one-time Studio change Saeed made as part of the D65 deploy:

1. Authentication → Email Templates → **Magic Link**.
2. Replace the URL-bearing body (`<a href="{{ .ConfirmationURL }}">…</a>` or the post-D50 token_hash URL) with a text-rendered code:

   ```
   Hello,
   
   Your sign-in code for the Yarmouk Study admin console is:
   
       {{ .Token }}
   
   Enter this code on the sign-in page within 60 minutes. If you didn't request a sign-in code, you can ignore this email.
   ```

3. Use `{{ .Token }}` (the 6-digit code), **NOT** `{{ .TokenHash }}` (the URL-safe hash, used only by the legacy clickable flow).

### Diagnostic: codes not arriving / failing to verify

| Symptom | Likely cause | Action |
|---|---|---|
| "I never get the email" | Spam / promotions folder; Supabase SMTP rate limit; non-allowlisted email | Check spam; wait 60 sec and retry; verify email is in `admins` table |
| "Code says invalid every time" | Wrong digits; email scanner *might* still be opening the URL (legacy flow) before verify — rare for code-only emails | Re-request code (Resend), type carefully, verify immediately |
| `8+ verify_failed` per attempt in audit log | O365 Defender prefetching old-format URL emails | Confirm the Studio template change actually shipped + saved (re-check the template body in Authentication → Email Templates → Magic Link) |
| Successful login but bounce back to /admin/login | Session cookie not written | Server-side `verifyOtp` should have written cookies via next/headers — check Vercel function logs for `[admin-auth]` errors; check that middleware matcher still covers `/admin/:path*` |

### Backward compat — `/admin/callback` still resolves

`/admin/callback` is untouched. Any in-flight email sent BEFORE the template change still has a clickable URL pointing at `/admin/callback?token_hash=…&type=email` — and the route still calls `verifyOtp` with the token_hash on landing. The migration window is naturally short: Supabase magic-link tokens expire at the configured TTL (~60 minutes by default).

After the migration window closes (no in-flight legacy URLs in the wild), the `/admin/callback` route can be removed in a follow-up decision. Until then, it sits dormant for safety.

### What this fix does NOT cover

**Participant invitation/reminder `/r/<token>` flow is unchanged.** Any participant whose email domain runs URL-prefetching scanners (O365 Defender, Proofpoint, Mimecast, etc.) could hit the same vulnerability — Defender click → single-use token consumed → participant clicks → "invalid invitation." So far, the pilot participants haven't hit this pattern in audit (their tokens validate cleanly on the first real click). If it surfaces, the same fix shape works (code-based entry instead of URL), but it's a much bigger refactor — participants would need a UI to enter their code, and the consent + questionnaire flow would need to start from there instead of from the URL landing. **Logged for backlog**; not blocking pilot collection.

## Reading invitation-send failures (Session 3b-ii)

> **D64 update**: send-failure surface now has a UI artefact too — the amber **"send failed"** chip on `/admin/invitations` whenever the last send attempt failed (from the original send, a resend, or an auto-reminder dispatch). The chip clears automatically on the next successful send. The console-log distinction below is still useful for the *cause* breakdown, but is no longer Sura's primary signal that a send failed. See "Auto-reminders + send failures (D64)" below for the audit-log surface + diagnostic flow.

When a resend (`resendInvitationAction`) returns `emailed: false`, the UI shows the loud red panel with the new link — but the *cause* lives only in the dev/prod server log, and the two causes mean very different things. Check **which `console.error` fired** in `lib/actions/invitations.ts` / `lib/email/invitation.ts`:

- **`[invitations] resend decrypt_pii failed`** → a **Vault/key sev-1**. `decrypt_pii` couldn't read the recipient address, which means the encryption key path is broken — and that breaks **every PII read app-wide** (consent names, invitation names/emails, future exports). Stop and treat as a key-access incident (see "Disaster recovery: lost encryption key" below). The token *did* rotate (old link dead), so hand off the panel's `tokenUrl` manually, then fix the key path.
- **`[email] invitation send failed/threw for <refCode>` + `errorClass=send`** → a **transient Resend issue** (API down, rate limit, or — in test mode — recipient isn't the verified account address). Recoverable: resend again once Resend is healthy, or hand off the panel's `tokenUrl`. Not a data-integrity problem.
- **`[invitations] send-at-create email threw for <refCode> errorClass=config` or similar** → a **server misconfig** (missing `RESEND_API_KEY` env var, missing `NEXT_PUBLIC_SITE_URL`, malformed payload). The audit log will show the same `errorClass=config` bucket. Server-side fix needed (Saeed).

Same user-facing surface (loud panel + `tokenUrl`), very different operational severity. The log line + the audit `errorClass` is how you tell them apart.

## Revoking an invitation (owner-driven terminal kill)

The owner can revoke any non-submitted invitation from `/admin/invitations` — Revoke button beside Resend, owner-only, both hidden once a row is terminal (`status='submitted'` or `status='revoked'`). Revoke is the right tool when:

- The invitation went to the wrong recipient (typo, wrong person).
- The recipient is no longer eligible (withdrew interest, ineligible per the recruitment criteria).
- A security concern (link suspected leaked or shared beyond the intended recipient).

### What revoke does (three ops, atomic by effect — D61)

1. **Kills the magic link.** `token_hash` rotates to a freshly-minted hash whose plaintext is discarded — no one (including the owner) can ever produce a URL that validates against it. The old `/r/<token>` URL stops working immediately and redirects to `/invitation-invalid` on any future click.
2. **Sets `status='revoked'`.** The row's chip flips to the danger styling (`bg-dangerLight text-danger`). Resend and Revoke both vanish on the row (terminal state).
3. **Locks any in-progress response.** If the recipient already clicked the link and started answering, `responses.is_locked` flips to `TRUE`. Their session is invalid at the next page load (`getSession()` returns `null` → bounces them to landing).

### What revoke does NOT do

- **Saved answers are retained.** A respondent's in-progress answers are NOT deleted — `is_locked` is a gate flag, not a CASCADE. The owner still reads them via `/admin/responses/<id>`. *If you want to remove a submitted response from research, see [Withdrawing a response](#withdrawing-a-response-owner-driven-research-data-removal) below — that's the right tool for the post-submission case.*
- **Not reversible.** Revoke is terminal. To re-invite, create a fresh invitation; pick a new `ref_code` (the original code is now permanently taken by the revoked row).
- **Does not email anything.** No notification to the recipient — they simply find the old link dead next time they click. (If you want them informed, send a manual email out-of-band.)

### The block-then-confirm gate (the in-progress case)

If the recipient is mid-flow (a response exists with `submitted_at IS NULL`), the first revoke click hits a UI gate. After the generic "Revoke X?" confirm, a SECOND confirmation fires with the honest wording:

> "X has started answering. Revoking will lock them out of continuing — their saved answers are retained and visible to you, but they cannot add more or submit. The magic link will also stop working. Continue?"

Read it carefully — the wording matches reality. The kick is silent from the respondent's side (their next page load bounces them to landing, no terminal page that says "your invitation was revoked"). Click through only if the kick is intentional.

### Handling a misdirected real invitation

1. Open `/admin/invitations`.
2. Find the row by `ref_code`. **Confirm it's the wrong one before clicking Revoke** — the action is terminal, no undo.
3. Click **Revoke**. First confirm: read + OK.
4. If the recipient already clicked: the second honest confirm fires. Read + OK (or cancel if you'd rather let them submit).
5. The row flips to `status=revoked` with the danger chip; both action buttons vanish.
6. To send to the correct recipient: `/admin/invitations/new`, pick a fresh `ref_code` (the original is taken by the revoked row).
7. Audit row appears at `/admin/security` as `invitation.revoke` (severity=warn) with `hadInProgressResponse` + `lockedResponseIds` metadata.

### Stale-tab self-correction

If two admin tabs both show the same invitation as revocable and one revokes it, the other tab will surface `already_revoked` on the next click and **auto-refresh** to the canonical terminal state (chip flips, buttons vanish). No manual reload needed. This is intentional — when the app knows the display is stale, it self-corrects rather than instructing the user.

## Withdrawing a response (owner-driven research-data removal)

The owner can withdraw any **submitted** response from `/admin/responses/<id>` — Withdraw button inside the new "Withdrawal" section card, between Consent and Answers, owner-only. Withdraw is the right tool when:

- A participant retracts their consent post-submission.
- An ethics issue surfaces with a specific response (e.g. the respondent admits the answers weren't really theirs).
- The wrong recipient submitted under a ref_code intended for someone else.

For in-progress (not-yet-submitted) responses, use **Revoke invitation** instead — that locks the session and retains the draft for owner inspection. The withdraw action returns `not_submitted` with explicit on-screen guidance if you try to withdraw an in-progress response.

### What withdraw does (one atomic UPDATE — D63)

1. **Flips `responses.status` to `'withdrawn'`** and **sets `responses.withdrawn_at = NOW()`** in a single statement. The structural CHECK `responses_withdrawn_state_consistent` enforces these two columns stay in sync; any future code path that flips one without the other gets a 23514 at write time.
2. **Writes an audit row at `alert` severity** — `action='response.withdraw'`, resource=ref_code, metadata=`{ responseId, invitationId, refCode, consentSignedAt }`. This is the FIRST `alert`-severity action in the system; the tier is reserved for data-altering admin actions on submitted research data.
3. **Refreshes the detail page** — the header status badge flips to "Withdrawn", the Withdrawal section card switches from button-mode to timestamp-mode ("Withdrawn at \<ts\>"), and the action button is unmounted. No manual reload needed.

### What withdraw does NOT do

- **No data deletion.** This is a SOFT delete — the response row, its answers, consent record, applied tags, researcher notes, and any recordings ALL survive. Withdrawn responses are excluded from exports, ATLAS.ti, analytics, dashboards, and feedback hubs (filter pass at every aggregating read site — D63). The consent_records row stays as cryptographic proof of consent (IRB chain-of-custody).
- **Not reversible via the UI.** The semantic withdrawal is final — there is no Un-withdraw button. If you genuinely need to restore a row to active (e.g. you withdrew the wrong refCode), do it via Studio: `UPDATE responses SET status='active', withdrawn_at=NULL WHERE id='<id>';` — but record the reason somewhere outside the audit_log (the audit chain will show withdraw+restore as two separate events and may need narrative context for IRB).
- **Does not notify the participant.** No email; no terminal page. Their /r/\<token\> link is unaffected.

### Withdraw-then-resend re-opens the invitation slot (intentional)

This is the load-bearing behavior to know about. After you withdraw a response, the invitation's resend and revoke gates BOTH treat the slot as if no submitted response existed — they filter to `status='active'`. Concretely:

- **Resend after withdraw** rotates the token and fires a fresh email to the same recipient under the same ref_code. Slot re-opens.
- **Revoke after withdraw** works (because the gate no longer sees a submitted response). Invitation flips to revoked terminal.

The audit chain (`response.withdraw` at alert → subsequent `invitation.resend` or `invitation.revoke`) preserves the full history. **To prevent re-use after a withdraw, follow with revoke.** This is the right pattern when the recipient retracted consent and shouldn't be re-invited; without the revoke, the rotated link is still claimable if you later resend.

**Note: invitation status doesn't update on withdraw.** A submitted invitation with all responses withdrawn will still show `submitted` status in the invitations list — the invitation lifecycle is independent of response withdrawal (no cascade by design — D63). The mixed signal (submitted chip + active Resend button) is semantically correct: the invitation DID produce a submission, AND that submission was retracted so the slot is back in play. The authoritative withdrawal state is on the response detail page (header "Withdrawn" chip + the Withdrawal section card's timestamp view); the audit chain (`invitation.create` → `invitation.send` → `response.submit` → `response.withdraw`) preserves the full history.

### List view + audit surface

- `/admin/responses` defaults to hiding withdrawn rows. Click **Show withdrawn** to opt in — withdrawn rows appear with a danger-styled "Withdrawn" chip alongside the invitation status. URL is `?withdrawn=show` (bookmarkable).
- `/admin/security` shows the `response.withdraw` row at `alert` severity; the `forbidden`-attempt variant (`response.withdraw.forbidden` at `warn`) appears if a readonly admin tries to invoke the action directly.

### Stale-tab self-correction

Same as revoke — if two admin tabs both show the same response as withdrawable and one withdraws it, the other tab surfaces `already_withdrawn` on the next click and **auto-refreshes** to the withdrawn state.

## Auto-reminders + send failures (D64)

D64 added automated 7d / 14d reminder emails and a "send failed" badge on `/admin/invitations` so Sura can see which invitations didn't reach their recipient. Four workflows below: how the cron works, when to resend vs revoke + create new, editing reminder templates, and a diagnostic flow for "I can't open my invitation link."

### How the auto-reminder cron works

A Vercel cron hits `/api/cron/send-reminders` daily at `0 12 * * *` UTC (Hobby plan: within-the-hour precision; Pro: exact-minute). For each non-submitted invitation:

- ~7 days after `sent_at` → **reminder1** fires (the "First reminder" template).
- ~14 days after `sent_at` → **reminderFinal** fires (the "Final reminder" template).
- Both reuse the ORIGINAL token URL (Path B / D64 — no token rotation). Recipients can click EITHER the original invitation email OR the reminder email — both point at the same `/r/<token>` and both work through the entire cycle.

The cron is **idempotent by design**: re-firing the same window produces no double-sends. The candidate query gates on `reminder1_sent_at IS NULL` / `reminder_final_sent_at IS NULL`, and the stamp + the row's failure-clear write in a single atomic UPDATE. You can manually fire the cron for spot-checks using the Bearer auth pattern:

```bash
export CRON_SECRET="<from Vercel env>"
curl -i \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://karasneh-research.org/api/cron/send-reminders
```

Response JSON has four counter numbers only — no refCode list, no IDs, no recipient data:

```
{"reminder1":{"sent":1,"failed":0},"reminderFinal":{"sent":0,"failed":0}}
```

Auth on the route is **exact-match** on the full `Bearer <secret>` string. A `401 Unauthorized` means the secret is wrong or the header didn't arrive. A `500 Server misconfigured` means a required env var (`RESEND_API_KEY` or `NEXT_PUBLIC_SITE_URL`) is missing — check `console.error` in Vercel function logs for which.

Per-row failures land in `/admin/security` as `invitation.email_failed` (severity=`warn`) and the row gets the amber **"send failed"** chip on `/admin/invitations`. Audit metadata is `{ invitationId, kind, errorClass }` only — never the recipient address or the Resend error message (PII discipline at the audit boundary; D64).

**Vercel cron audit metadata note**: when the cron fires from Vercel (not a manual curl), the audit row's `ip` is a Vercel edge IP and `user_agent` is `vercel-cron/1.0`. A manual curl from your terminal leaves your curl client + IP in the audit row. Both are operational metadata, neither is participant PII.

### Pre-D64 invitations are excluded from auto-reminders

Invitations created BEFORE D64 shipped have `token_plaintext_encrypted IS NULL` (the column didn't exist at their mint time, and there's no cryptographic way to recover the plaintext from `token_hash`). The cron's candidate query excludes them automatically. For these, **click Resend manually on `/admin/invitations`** — that rotates the token, populates the encrypted plaintext column, and from then on the auto-reminder cycle is active for that row.

### Resend (manual nudge) vs Revoke + Create new (restart)

Two distinct workflows; pick by intent:

- **Resend** (the button on `/admin/invitations`): you want to send the recipient ANOTHER copy of their (now-rotated) link. Continues the current outreach cycle. Token rotates (old link dies), new link emailed. **The auto-reminder state is preserved** — if a reminder already fired on this invitation, resend does NOT re-trigger the auto-cycle. Same `ref_code`. Use when: recipient says they didn't get the email but is otherwise reachable; you want to surface the invitation in their inbox again without restarting the 7d/14d nudge clock.

- **Revoke + Create new**: you want to restart the full outreach cycle. Revoke the old invitation (terminal — sets `status='revoked'`, kills the link), then create a fresh invitation with a NEW `ref_code` and a clean 7d/14d window. Use when: the recipient lost the entire email thread and you want a clean restart; OR you want a fresh outreach record in the audit log under a new ref_code; OR you want the recipient to start fresh with no prior tokens in their inbox.

The audit chain preserves the distinction: a resend appears as `invitation.resent` (severity=info); a revoke + create-new appears as `invitation.revoke` (warn) followed by `invitation.create` (info) under a new ref_code.

### Editing reminder templates

Both reminders are editable at `/admin/settings/email-templates` (owner-only) alongside the participant invitation, supervisor invitation, and submission notification. The list page now orders them chronologically by outreach cycle: **invitation → first reminder → final reminder → admin-invite → submission**.

Each reminder inherits the same 5 sections as the participant invitation (`intro`, `cta`, `personal`, `expiry`, `contact`). Sura can edit any section per template independently — for example, removing `personal` from the final reminder if she wants leaner copy on the urgent nudge. The defaults ship with brand-consistent copy across the three respondent-facing emails (invitation → reminder1 → reminderFinal share `personal` / `expiry` / `contact` verbatim; only the `intro` differs + the subjects). All editor controls (placeholder validation, save / reset / send-test, bilingual EN+AR fields) work the same as the participant invitation — see "Email templates" section below for full editor behavior.

**Review the reminder defaults before the first real auto-reminder fires in production.** The defaults are good-enough-to-edit, not good-enough-to-ship-unchanged for high-stakes recipients (Officials, Donors). Open `/admin/settings/email-templates/reminder1` + `/admin/settings/email-templates/reminderFinal` and tune the tone for your voice before any auto-cycle dispatches.

### Diagnosing "I can't open my invitation link"

If a participant says their link is broken:

1. Open `/admin/invitations` and find the row by `ref_code` (or by recipient name if you know it from your own records — names aren't displayed to readonly admins).
2. Check `status`:
   - **`revoked`** → the link is permanently dead by design (D61). Create a fresh invitation with a new ref_code.
   - **`submitted`** → the response is already finalized. The link is one-use post-submit (D44/D52); they're seeing the expected post-submission behavior. If they need to re-submit, withdraw (`/admin/responses/<id>`, Withdraw button) then create a fresh invitation under a new ref_code.
   - **`expired`** → past `expires_at`. Create a fresh invitation with a new expiry.
   - **`sent`** / **`opened`** → the link SHOULD work. Continue to step 3.
3. Check the amber **"send failed"** chip on the row:
   - **No chip** → the last send succeeded. Ask the participant to check their spam / promotions folder. If they really don't have the email, click **Resend** (sends a fresh token under the same ref_code; auto-reminder state preserved per Option A).
   - **Chip present** → the most recent send (original, resend, or auto-reminder) failed at the Resend API layer. Open `/admin/security` and find the matching `invitation.email_failed` audit row to read the `errorClass`:
     - `errorClass=send` → Resend rejected (transient API, malformed address, rate limit). Click Resend to retry; should clear the chip if the issue was transient.
     - `errorClass=config` → wrapper-layer failure (missing `RESEND_API_KEY`, missing locale defaults, etc.). Server-side fix needed (talk to Saeed).

The `last_send_failed_at` chip clears automatically on the next successful send from the same row. No manual reset needed.

### Inspecting an invitation's reminder state via Supabase Studio

```sql
SELECT
  ref_code, status, sent_at,
  reminder1_sent_at, reminder_final_sent_at,
  last_send_failed_at,
  token_plaintext_encrypted IS NOT NULL AS auto_reminder_eligible
FROM invitations
WHERE ref_code = '<paste here>';
```

`auto_reminder_eligible = false` means it's a pre-D64 row — manual Resend will populate the column and the auto-cycle activates from there.

### Known limitation: async bounces don't surface to the chip

Resend's `.invalid` TLD acceptance + async-bounce behavior was observed during D64 smoke: a syntactically-valid but undeliverable address (e.g., `bounce@example.invalid`) returns 200 at the API layer, so the wrapper sees `{ok: true}` and the chip never fires — the bounce surfaces later via Resend's webhook system, which the platform doesn't currently consume. For now, the chip catches sync API rejections only (auth failures, rate limits, malformed addresses Resend validates client-side). A future Resend-webhook integration would close the "email looked sent but didn't arrive" gap. Out of D64 scope. If you suspect a recipient never received a reminder despite `reminder*_sent_at` being stamped, check Resend's dashboard for the bounce event.

## Email templates (the 5 editable templates + reset path)

The platform sends 5 emails, all editable at `/admin/settings/email-templates` (owner-only). The button URL in each is **system-owned** (Sura edits only the LABEL — the link itself cannot be removed or broken from the editor).

| Template | Bilingual? | Recipient | Trigger |
|---|---|---|---|
| **Participant invitation** (`invitation`) | EN + AR | Invited expert | Owner clicks "Send" on a new or resent invitation (`lib/actions/invitations.ts`). |
| **First reminder** (`reminder1`) | EN + AR | Invited expert (not yet submitted) | Auto-sent by `/api/cron/send-reminders` ~7 days after `sent_at` (D64). |
| **Final reminder** (`reminderFinal`) | EN + AR | Invited expert (not yet submitted) | Auto-sent by `/api/cron/send-reminders` ~14 days after `sent_at` (D64). |
| **Supervisor invitation** (`admin-invite`) | EN only | Read-only supervisor | Owner adds a supervisor via Settings → Team Access (`lib/actions/admins.ts`). |
| **Submission notification** (`submission`) | EN only | Active owner(s) | Respondent submits; fan-out via `lib/notifications.ts`. |

EN-only templates HIDE the Arabic column in the editor (NOT render empty AR fields). Same Send-test path on all five — inert button URL lands on `/?preview=<id>-email` (the public landing ignores all query strings; no token is ever consumed by a test click). The two reminder templates share the participant invitation's 5-section structure (`intro / cta / personal / expiry / contact`); see "Editing reminder templates" above for the per-template editing notes.

### Resetting a template to defaults

Use this when an edit needs undoing, or to clear smoke-test customization before launch (as Saeed did 2026-05-31 to clear the leftover D22 Stage 1 customization on Participant invitation).

1. `/admin/settings/email-templates` → click the template (e.g. **Participant invitation**).
2. The form pre-fills with the saved customization; the badge reads `customized`.
3. Scroll to the editor footer. Beside **Save changes** is **Reset to default** (muted, hover turns red).
4. Click it. Browser `window.confirm`: *"Discard your customizations for this template? The default English/Arabic copy will be restored."* Click OK.
5. Banner reads "Reset to default." The list page now shows the `default` chip and "shipping defaults" in the right column.
6. Audit log at `/admin/security` shows `template.reset` (severity=info) with `metadata.adminId`. **The deletion is auditable** — that's why we use the UI button, not a repo-level DELETE.

### Sending a test email

Each editor page has a **Send test** panel below Save / Reset. It sends the *currently edited* copy (not the saved version) to an email address of your choice — defaults to your own owner email.

- Subject prefixed `[TEST]`; body carries a banner reminding the recipient that the button is inert.
- 30-second cooldown per actor between test sends (logged via `audit_log.action='template.test_send'`).
- Bilingual templates show a language picker (EN / AR); EN-only templates skip it.
- **Creates nothing**: no token minted, no invitation row, no response row. Click-tracking is the inert URL → public landing only.

### What's NOT editable

- The button URL on any template (system-owned `button_href`).
- The HTML chrome (card / button colors / layout). Brand-uniform by design.
- The per-template structural sections (e.g. invitation always has `intro / cta / personal / expiry / contact`; can't add a new section or rename one without a code change).
- BCC owner toggle / global override — un-built tail of D22; not blocking; deferred to post-launch.

## First-time setup: Vault keys

Required before applying any migration that references `pii_key_v*`. Without this, `decrypt_pii` finds no key in Vault and PII reads/writes fail.

1. Generate a 32-byte key:
   ```
   openssl rand -base64 32
   ```
2. Copy the output (a ~44-character base64 string).
3. Supabase Studio → **Vault** (left sidebar; under "Project Settings" in some versions) → **Add new secret**.
4. Set:
   - **Name**: `pii_key_v1`
   - **Secret**: paste the openssl output
   - **Description**: `pgcrypto key for PII columns (recipient_*_encrypted, signed_name_encrypted). See DECISIONS.md D36.`
5. Save.
6. Verify in SQL Editor:
   ```sql
   SELECT name, decryptable FROM vault.decrypted_secrets WHERE name = 'pii_key_v1';
   ```
   Expect one row, `decryptable = true`.
7. **Store the same key in your password manager**, labelled `Yarmouk — pii_key_v1 (active)`. This is the only backup. See "Disaster recovery" below for why this step matters.

## Key rotation: pii_key_v(N+1)

Run when a key needs to be retired (suspected compromise, scheduled rotation, or any time the active key has been exposed somewhere it shouldn't have been).

1. Generate the new key: `openssl rand -base64 32`.
2. In Vault, add it as `pii_key_v(N+1)` (e.g., `pii_key_v2`). **Do not delete the previous key.** `decrypt_pii` falls back to older versions for ciphertext written under them.
3. Update the password manager:
   - Add new entry: `Yarmouk — pii_key_v(N+1) (active)`
   - Re-label the previous: `Yarmouk — pii_key_v(N) (previous, still required for old ciphertext)`
   - Keep both entries.
4. New PII writes will automatically use the highest version. Old reads continue to work via the fallback path.
5. *(Optional, recommended after a few weeks)* Backfill: an Owner-only maintenance script re-encrypts existing rows under the new key. Once verified, delete `pii_key_v(N-1)` from Vault and re-label the password-manager entry `Yarmouk — pii_key_v(N-1) (retired, safe to delete)`.
6. Run the encrypt/decrypt smoke-test query against a known sample row to confirm the rotation didn't break anything.

## Disaster recovery: lost encryption key

If the active Vault key is deleted from Vault, **don't generate a replacement under the same name yet** — a new key won't decrypt data written under the old key, and creating a same-named key would mask the loss rather than fix it.

**Step 1 — Check the backup first.** The password manager should contain an entry named `Yarmouk — pii_key_v1 (active)` (or whichever version is current). If it's there:

- Add it back to Vault under its original name.
- Re-run the verification query: `SELECT decryptable FROM vault.decrypted_secrets WHERE name = 'pii_key_v1';` — expect `true`.
- Confirm by decrypting a known sample row. PII is readable again. No further action required.

**Step 2 — If the password manager copy is also missing**, consider any offline backups (encrypted USB, paper copy in a safe). The key is a 44-character string; if it was ever written down or exported, it's still recoverable.

**Step 3 — If the key is truly unrecoverable**, here is what that means in concrete terms:

**What's permanently unreadable:**
- `recipient_name_encrypted` and `recipient_email_encrypted` on the `invitations` table
- `signed_name_encrypted` on the `consent_records` table

**What is *not* affected** (the platform keeps working):
- `ref_code` on each invitation — the anonymized display ID is plaintext and was never encrypted.
- The entire analytical dataset: `questions`, `responses`, `answers`, `response_tags`, `researcher_notes`, `recordings.transcript_anonymized` (when published), `audit_log`.
- Settings, the questionnaire content, tags, and every dashboard view.

**Methodologically**, the thesis defense data is intact. The analytical dataset is anonymized by design (D4) — analysis never depended on the encrypted columns. Losing PII means losing the operational ability to identify which invitation went to which person, not losing any research finding. If new invitations need to be sent (e.g., to continue data collection), generate fresh tokens with fresh PII; the existing analytical data is unaffected and still attributable to its ref_code.

**Then**, and only then, add a new key (`pii_key_v2`) and update the password manager. Existing ciphertext stays unreadable; new writes work normally.

## Backup & restore

Encrypted, DB-only. Two paths coexist:

- **Automated daily backup (D27 — live since 2026-05-27, restore-proven).** A
  GitHub Actions workflow dumps as `backup_ro` (Vault-blind), encrypts, and
  uploads to Cloudflare R2 every day at 03:00 UTC. This is the durable
  data-loss guarantee. See "Rehearsed restore — CI-produced blob" below.
- **Manual on-demand backup.** `npm run backup` — the runbook for ad-hoc
  rehearsals, milestone snapshots before risky operations, and any moment
  you want a fresh blob NOW rather than waiting for the cron. Stays useful
  as the FLOOR even though the cron is the durable fix.

Free-tier Supabase provides **no** platform backups, so these two paths are
the recovery path (see "Limitations" below for what's still v1-scope).

### How to back up

    npm run backup

Produces `backups/yarmouk-YYYYMMDD-HHMM.yarmoukbackup` — an encrypted archive
(`supabase db dump --linked` schema + data → `tar.gz` → `openssl enc
-aes-256-cbc -pbkdf2`). The `backups/` dir is **gitignored and project-local**.

**Then copy it OFFSITE** to Saeed's Mac backup location. The project-local
`backups/` dir is **not** an offsite copy — a disk loss takes the repo and the
backup together. Run a backup **before any significant operation** (migration,
V2 publish, bulk change) and **periodically once real data exists**.

### During-collection backup routine

D27's daily cron (03:00 UTC, encrypted blob to R2) is the durable data-loss
guarantee. This manual routine is no longer the floor — it's a SUSPENDERS
to the cron's belt: useful when you want a fresh blob BEFORE/AFTER a
milestone (rather than waiting for the next 03:00 UTC), or to keep a local
copy on Saeed's Mac as an extra offsite layer.

- **Who:** the Owner (Saeed during dev hand-off; Sura once sole researcher).
- **When (optional, not required):** immediately before/after a milestone
  (activating a variant, closing a variant, a bulk invitation send). The
  daily cron already covers the steady-state daily floor.
- **Each run:** `npm run backup` → copy the new `.yarmoukbackup` **offsite**
  (see "How to back up" above) → keep the three secrets separate (see "The three
  secrets" below).
- **Retention (manual blobs):** keep the milestone snapshots; the R2-side
  30-day rolling lifecycle handles the daily-cron blobs.

To recover, see "Restore" below.

### The three secrets (a backup is useless without ALL THREE — stored SEPARATELY)

1. **The `.yarmoukbackup` file** — the encrypted dump (keep offsite).
2. **`BACKUP_PASSPHRASE`** — password manager: **"Yarmouk — BACKUP_PASSPHRASE"**.
   Decrypts the archive. **If lost, the file is permanently unrecoverable** (D28)
   — there is no recovery path for a forgotten passphrase.
3. **Vault key `pii_key_v1`** — password manager: **"Yarmouk — pii_key_v1
   (active)"**. Decrypts the PII columns. Without it the analytical data restores
   fine, but `recipient_name_encrypted` / `recipient_email_encrypted`
   (invitations) and `signed_name_encrypted` (consent_records) stay unreadable
   ciphertext. See "Disaster recovery: lost encryption key" above.

Keep them apart — the file offsite, the two secrets in the password manager. No
single loss should both expose readable PII and destroy recoverability.

### What's IN / NOT IN the backup

**IN** — the `public` schema: **all 17 tables (structure + data)**. PII columns
are included **as ciphertext** (readable only with the Vault key).

**NOT IN** (recovered separately):
- **The Vault key** — managed `vault` schema; never dumped. Reinstate from the
  password manager.
- **`auth.users`** (admin login identities) — managed `auth` schema;
  re-provision per "Admin auth bootstrap" above.
- **Storage objects / recordings audio** — live in Storage, not the DB. Empty
  now (text-first); **add a Storage backup step here when interviews start
  being recorded.**
- **Supabase-managed roles / schemas / RLS-policy grants** — recreated by the
  platform + `supabase db push` (from migrations), not by this dump.

### Restore — VERIFIED data round-trip (proven 2026-05-24)

The conservative worst case we actually exercised: restore into a **bare**
throwaway Postgres and confirm the public data comes back.

    # 1. Decrypt + untar into a temp dir (BACKUP_PASSPHRASE from .env.local; never echo it)
    TMP="$(mktemp -d)"
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -in backups/yarmouk-YYYYMMDD-HHMM.yarmoukbackup \
      -pass env:BACKUP_PASSPHRASE | tar -xzf - -C "$TMP"
    #   → $TMP/schema.sql + $TMP/data.sql

    # 2. Throwaway postgres:17 (matches live PG major)
    docker run -d --name yarmouk-restore-test -e POSTGRES_PASSWORD=test postgres:17
    until docker exec yarmouk-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

    # 3. Restore schema, then data (continue past benign errors)
    docker exec -i yarmouk-restore-test psql -U postgres -v ON_ERROR_STOP=0 < "$TMP/schema.sql"
    docker exec -i yarmouk-restore-test psql -U postgres -v ON_ERROR_STOP=0 < "$TMP/data.sql"

    # 4. Verify count(*) per table vs live — expect every one to match
    docker exec yarmouk-restore-test psql -U postgres -tA -c "
    select 'admins',count(*) from admins
    union all select 'answers',count(*) from answers
    union all select 'audit_log',count(*) from audit_log
    union all select 'backups',count(*) from backups
    union all select 'consent_records',count(*) from consent_records
    union all select 'email_templates',count(*) from email_templates
    union all select 'invitations',count(*) from invitations
    union all select 'notification_preferences',count(*) from notification_preferences
    union all select 'notifications',count(*) from notifications
    union all select 'questionnaire_versions',count(*) from questionnaire_versions
    union all select 'questions',count(*) from questions
    union all select 'recordings',count(*) from recordings
    union all select 'researcher_notes',count(*) from researcher_notes
    union all select 'response_tags',count(*) from response_tags
    union all select 'responses',count(*) from responses
    union all select 'settings',count(*) from settings
    union all select 'tags',count(*) from tags"
    #   Compare against live: supabase db query --linked with the same query.

    # 5. Tear down
    docker rm -f yarmouk-restore-test ; rm -rf "$TMP"

**Expected-benign errors** (NOT failures): `role "…" does not exist`
(Supabase-managed roles — `supabase_admin`, `authenticated`, `anon`,
`service_role`), `schema "auth"/"storage" does not exist`, `extension
"supabase_vault" is not available`, `publication "supabase_realtime" does not
exist`, and `COPY`-cascade `syntax error` / `trailing junk` lines from those
missing-schema blocks. **Only public-schema success matters** — confirm all 17
tables exist with matching row counts. (2026-05-24: all 17 matched; no error
touched the public schema.)

### Rehearsed restore — CI-produced blob (proven 2026-05-27)

The full procedure exercised against an actual D27 CI-produced blob from
R2. **This is the emergency runbook** for the durable backup path: download
the most recent blob from R2, restore to a throwaway `postgres:17`, and
verify counts against live. Step-exact — vanilla `postgres:17` will NOT
restore clean without the role + cross-schema stubs in step 5.

**Prerequisites on the machine you restore from:** `docker` (daemon
running), `openssl` (any 3.x), `psql` (any version ≥ 14 — restoring plain
SQL is forward-compatible). Plus the three secrets, each from its
separate store (see "The three secrets" above).

#### 1. Download the most recent blob from R2

Cloudflare dashboard → R2 → `yarmouk-backups` bucket → click the
top-of-list `yarmouk-YYYYMMDD-HHMM.yarmoukbackup` (newest by timestamp) →
Download. Place at any local path; this runbook assumes
`~/Downloads/yarmouk-YYYYMMDD-HHMM.yarmoukbackup`.

(CLI alternative: `aws --endpoint-url $R2_ENDPOINT s3 cp s3://yarmouk-backups/<name> ./`
with R2 creds temporarily in env. The UI path is preferred — keeps R2
write/list creds off the recovering machine.)

#### 2. Write the passphrase to a 0600 file (we use `openssl -pass file:`)

Use `printf` (not `echo`) so there's no trailing newline — a stray `\n`
flips the passphrase by one byte and decrypt silently fails:

    printf '%s' '<the BACKUP_PASSPHRASE>' > ~/.restore-proof.passphrase
    chmod 600 ~/.restore-proof.passphrase
    # Quick sanity (does NOT print the value):
    wc -c ~/.restore-proof.passphrase
    # byte count must equal passphrase length EXACTLY (+1 = trailing newline)

#### 3. Decrypt + extract

    mkdir -p /tmp/restore-proof
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -pass file:$HOME/.restore-proof.passphrase \
      -in $HOME/Downloads/yarmouk-YYYYMMDD-HHMM.yarmoukbackup \
      -out /tmp/restore-proof/dump.tar.gz
    tar -xzf /tmp/restore-proof/dump.tar.gz -C /tmp/restore-proof/
    # → /tmp/restore-proof/schema.sql + /tmp/restore-proof/data.sql

Decrypt failure here means the local passphrase file diverged from the
GitHub `BACKUP_PASSPHRASE` secret used by CI at encryption time. Fix both
to match, re-dispatch the workflow to produce a new blob, retry.

#### 4. Spin throwaway `postgres:17`

    docker run --rm -d --name yarmouk-restore-proof \
      -e POSTGRES_PASSWORD=throwaway -p 55432:5432 postgres:17
    until docker exec yarmouk-restore-proof pg_isready -U postgres -q; do sleep 1; done

#### 5. Pre-seed cross-schema + role stubs — REQUIRED

Vanilla `postgres:17` lacks the Supabase-provided `authenticated` role and
the `auth` / `vault` / `extensions` schemas the public-schema dump
references. Without these stubs, schema apply throws ~50 errors on RLS
policies + GRANTs (silently skipped → a restored DB with no RLS, a real
correctness gap if you trusted it). Apply BEFORE `schema.sql`:

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=on <<'SQL'
    CREATE ROLE authenticated;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS vault;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (id UUID PRIMARY KEY, name TEXT, decrypted_secret TEXT);
    CREATE OR REPLACE FUNCTION auth.uid()  RETURNS UUID  LANGUAGE sql AS $$ SELECT NULL::UUID  $$;
    CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS JSONB LANGUAGE sql AS $$ SELECT NULL::JSONB $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT  LANGUAGE sql AS $$ SELECT NULL::TEXT  $$;
    SQL

Runtime behavior of these stubs returns NULL — fine, since this restore-
proof is count-verify, not RLS / encryption exercise.

#### 6. Apply schema with errors-don't-stop; classify any error

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres \
      -v ON_ERROR_STOP=off \
      -f /tmp/restore-proof/schema.sql \
      2> /tmp/restore-proof/schema-apply.stderr
    grep -E 'ERROR' /tmp/restore-proof/schema-apply.stderr \
      | sed 's/.*ERROR:  //' | sort | uniq -c

Expected after stubs: **exactly one benign error** — `schema "public"
already exists` (postgres:17 ships `public`; dump's `CREATE SCHEMA public`
is redundant; a real Supabase restore target also has it). Anything else
is a real signal — likely a stub gap from a new Supabase role/schema
referenced upstream.

#### 7. Apply data with FK deferral (`session_replication_role = replica`)

The `admins.id → auth.users(id)` FK has no target rows in our empty stub
`auth.users`. Without deferral, the COPY would FK-fail and admins rows
would silently NOT load — a false-pass risk on a count-verify. Use the
standard pg_restore idiom:

    (
      echo "SET session_replication_role = replica;"
      cat /tmp/restore-proof/data.sql
      echo "SET session_replication_role = origin;"
    ) | PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres \
          -v ON_ERROR_STOP=off \
          2> /tmp/restore-proof/data-apply.stderr
    grep -E 'ERROR' /tmp/restore-proof/data-apply.stderr | sed 's/.*ERROR:  //' | sort | uniq -c

Expected: ZERO errors. The orphan `admins.id → empty auth.users` FK is
expected and explained — Supabase's `auth` schema is managed separately
and populated by re-provisioning admins in a real restore target.

#### 8. Count-verify against live — JOIN BY NAME (not paste-by-line)

In Supabase Studio → SQL Editor, run the live UNION:

    SELECT 'admins'                  AS t, COUNT(*)::int FROM admins
    UNION ALL SELECT 'answers',                COUNT(*)::int FROM answers
    UNION ALL SELECT 'audit_log',              COUNT(*)::int FROM audit_log
    UNION ALL SELECT 'backups',                COUNT(*)::int FROM backups
    UNION ALL SELECT 'consent_records',        COUNT(*)::int FROM consent_records
    UNION ALL SELECT 'email_templates',        COUNT(*)::int FROM email_templates
    UNION ALL SELECT 'invitations',            COUNT(*)::int FROM invitations
    UNION ALL SELECT 'notification_preferences', COUNT(*)::int FROM notification_preferences
    UNION ALL SELECT 'notifications',          COUNT(*)::int FROM notifications
    UNION ALL SELECT 'questionnaire_versions', COUNT(*)::int FROM questionnaire_versions
    UNION ALL SELECT 'questions',              COUNT(*)::int FROM questions
    UNION ALL SELECT 'recordings',             COUNT(*)::int FROM recordings
    UNION ALL SELECT 'researcher_notes',       COUNT(*)::int FROM researcher_notes
    UNION ALL SELECT 'response_tags',          COUNT(*)::int FROM response_tags
    UNION ALL SELECT 'responses',              COUNT(*)::int FROM responses
    UNION ALL SELECT 'settings',               COUNT(*)::int FROM settings
    UNION ALL SELECT 'tags',                   COUNT(*)::int FROM tags
    ORDER BY t;

Save the result as `/tmp/restore-proof/live.csv` (one `table,count` per
line). Same UNION against the restored DB:

    PGPASSWORD=throwaway psql -h localhost -p 55432 -U postgres -d postgres -t -A -F',' -c \
      "<same UNION>" > /tmp/restore-proof/restored.csv

Diff JOIN-BY-NAME (NOT paste-by-line — postgres `ORDER BY` is
locale-aware; the alphabetic order of `response_tags` vs `responses`
differs between byte-order and en_US.UTF-8 collation, so a line-paste
diff produces FALSE mismatches):

    join -t',' <(sort /tmp/restore-proof/live.csv) <(sort /tmp/restore-proof/restored.csv) \
      | awk -F',' '{ printf "%-25s %4d %4d  %s\n", $1, $2, $3, ($2==$3?"✓":"✗ MISMATCH") }'
    # Set-completeness sanity:
    diff <(cut -d',' -f1 live.csv | sort) <(cut -d',' -f1 restored.csv | sort)

**Pass condition:** all 17 tables match. A mismatch on any table — even a
zero-table going non-zero, or a non-zero coming up short — is a real
finding and must be chased, NOT waved away.

#### 9. Teardown

    docker rm -f yarmouk-restore-proof
    rm -rf /tmp/restore-proof
    rm ~/.restore-proof.passphrase     # passphrase footprint back to zero

#### Last full rehearsal

2026-05-27 — CI-produced blob `yarmouk-20260526-1709.yarmoukbackup` (20.86 KB).
Decrypt: OK. Schema apply: 1 benign error (`schema "public" already exists`).
Data apply: 0 errors. Count diff: all 17 tables matched (98 rows across 6
non-zero tables: admins=3, audit_log=19, email_templates=1, questionnaire_versions=9,
questions=57, settings=9). D27 STEP 4 closed.

### Full disaster recovery (DOCUMENTED — NOT yet rehearsed end-to-end)

A real recovery targets a **Supabase project** (new or reset), where the managed
roles / schemas / RLS already exist — so the benign bare-postgres errors above
don't occur. Outline:

1. **Provision the target** — a fresh Supabase project, or reset the existing
   one. *(Mind the 2-project free-tier limit.)*
2. **Recreate schema + RLS + roles** — `supabase db push` from
   `supabase/migrations/` (authoritative), **or** restore the `schema.sql` layer.
3. **Restore public data** — load `data.sql` from the decrypted backup.
4. **Re-provision auth identities** — recreate the admin `auth.users` per "Admin
   auth bootstrap" above (`admins` rows + dashboard auth users, reconciled ids).
5. **Reinstate the Vault key** — add `pii_key_v1` from the password manager per
   "Disaster recovery: lost encryption key" above, so PII decrypts.
6. **Re-link the CLI** — `supabase link --project-ref <ref>`.

**Honesty marker:** the **DATA round-trip is PROVEN** twice — 2026-05-24
(manual-blob count-verify) and 2026-05-27 (CI-blob from R2, full procedure
with stubs + `session_replication_role` deferral, see "Rehearsed restore"
above). The **full project-level DR above is DOCUMENTED but NOT yet
rehearsed end-to-end** — rehearse it before relying on it (a future
exercise; dry-run against a scratch project when one is free).

### Limitations (v1 scope)

- **DB-only** — no Storage / audio (text-first; add when interviews are recorded).
- **Free-tier Supabase has no platform backups** — which is why this exists.
  The D27 daily cron + manual `npm run backup` are the only backup paths.
- **Recordings bucket NOT in dump** — Stage 2 item; add a Storage download step
  to the workflow when interviews start being recorded.
