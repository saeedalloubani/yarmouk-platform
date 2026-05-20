# Operations Runbook

Manual steps a human runs outside the codebase — Vault key setup, key rotation, disaster recovery, admin auth bootstrap. Migrations and scripts handle everything else. Decision rationale for these operations lives in `docs/DECISIONS.md` (D36 covers the Vault model; D4 covers what's encrypted and why; D49/D50/D51 cover admin auth).

## Admin auth bootstrap (Session 3a)

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

## Reading invitation-send failures (Session 3b-ii)

When a resend (`resendInvitationAction`) returns `emailed: false`, the UI shows the loud red panel with the new link — but the *cause* lives only in the dev/prod server log, and the two causes mean very different things. Check **which `console.error` fired** in `lib/actions/invitations.ts` / `lib/email/invitation.ts`:

- **`[invitations] resend decrypt_pii failed`** → a **Vault/key sev-1**. `decrypt_pii` couldn't read the recipient address, which means the encryption key path is broken — and that breaks **every PII read app-wide** (consent names, invitation names/emails, future exports). Stop and treat as a key-access incident (see "Disaster recovery: lost encryption key" below). The token *did* rotate (old link dead), so hand off the panel's `tokenUrl` manually, then fix the key path.
- **`[email] invitation send failed/threw for <refCode>`** → a **transient Resend issue** (API down, rate limit, or — in test mode — recipient isn't the verified account address). Recoverable: resend again once Resend is healthy, or hand off the panel's `tokenUrl`. Not a data-integrity problem.

Same user-facing surface (loud panel + `tokenUrl`), very different operational severity. The log line is how you tell them apart.

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
