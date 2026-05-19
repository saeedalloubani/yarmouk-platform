# Data Access Repos

PII-bearing tables — `invitations`, `recordings`, `consent_records` — are accessed **only** through the helpers in this directory. Pages, Server Actions, and Route Handlers must not call `supabase.from('invitations')` (etc.) directly.

## Why

See `docs/DECISIONS.md` → **D4** (anonymization at the database) and **D31** (PII tables accessed only via repos). RLS gates rows; views redact columns; the repo layer picks the right source based on the caller's role.

## The pattern

```ts
async function pickSource(supabase) {
  const role = await getCurrentAdminRole(supabase);
  return role === "owner" ? "invitations" : "invitations_redacted";
}
```

- **Owner** reads from the base table (full encrypted PII columns).
- **Read-only** reads from `*_redacted` (PII columns are NULL).
- **All writes** target the base table; RLS rejects non-Owner mutations.

The repo also maps `snake_case` DB columns to `camelCase` TS fields.

## Repos required (PII tables)

Direct `supabase.from(...)` calls are **prohibited** for:

| Table | Repo | Redacted view |
|---|---|---|
| `invitations` | `lib/repos/invitations.ts` | `invitations_redacted` (masks name/email; omits `token_hash` entirely) |
| `recordings` | `lib/repos/recordings.ts` | `recordings_redacted` (masks `audio_storage_path`, `audio_filename`, `transcript_original`, `substitution_key`; `transcript_anonymized` exposed only when `status = 'published'`) |
| `consent_records` | `lib/repos/consent.ts` | `consent_records_redacted` (masks `signed_name_encrypted`; consent booleans + timestamp + language exposed) |

## Tables that may skip the repo

These tables have no PII and no per-row redaction, so direct Supabase calls are fine (camelCase mapping can happen inline at the call site):

- `questions`, `questionnaire_versions`
- `responses`, `answers`
- `tags`, `response_tags`, `researcher_notes`
- `notifications`, `notification_preferences`
- `email_templates`
- `settings`
- `audit_log` (read access; writes go via the audit helper, not direct)

If a new PII column lands on any of these, **promote it to a repo** and add it to the table above.

## How to add a new repo

1. Mirror the structure of `invitations.ts`.
2. Define `DbRow`, `DbInsert`, `DbUpdate` aliases off `Database["public"]["Tables"]`.
3. Define a `DbViewRow` alias off `Database["public"]["Views"]` if there's a redacted view.
4. Write `rowToX(row)` for snake → camel mapping. Accept the union `DbRow | DbViewRow` so the same mapper handles both.
5. Write `pickSource(supabase)` calling `getCurrentAdminRole` from `lib/auth.ts`.
6. Export `getX`, `listX`, `createX`, `updateX` as needed by the rest of the app.
7. Add the table to the "Repos required" table above.

## Reading the redacted-view columns

When the repo serves a read-only admin, fields like `recipientNameEncrypted` are typed `string | null` and will be `null` at runtime. Callers should branch:

```ts
const invitation = await getInvitation(supabase, id);
if (invitation?.recipientNameEncrypted) {
  // Owner-only path. Safe to decrypt.
  const name = decrypt(invitation.recipientNameEncrypted);
}
```

Never throw on the null case — that would leak which fields are protected.
