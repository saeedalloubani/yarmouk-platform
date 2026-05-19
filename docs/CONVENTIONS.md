# Coding Conventions

Strict-ish. Deviations okay if commented with a reason.

## TypeScript

- TypeScript everywhere, `strict: true` in `tsconfig.json`.
- No `any` unless commented (`// any: parsing untyped third-party CSV`).
- Prefer `type` aliases for unions, `interface` for object shapes that may be extended.
- Use `satisfies` over type annotations for object literals to keep narrow types.
- Always type Server Action arguments and return values explicitly.

## React / Next.js

- **Server Components by default.** Add `"use client"` only when needed (state, effects, browser APIs).
- **Server Actions** for all mutations from the admin UI.
- **Route Handlers** (`app/api/.../route.ts`) only for:
  - File downloads (export endpoints)
  - Webhooks
  - Anonymous public endpoints (`/api/public/*`)
- Use `async/await` not `.then()`.
- Forms: React Hook Form + Zod resolver for anything non-trivial.
- Use Next's `<Link>` for in-app navigation. Never plain `<a>` for internal routes.

## File & Folder Naming

```
PascalCase.tsx        — React components (e.g., NotificationsBell.tsx)
kebab-case/           — App Router route segments (e.g., admin/analytics/feedback/)
kebab-case.ts         — Library files (e.g., lib/atlas-ti.ts)
SCREAMING_SNAKE.ts    — Never. Don't use this.
```

Each route folder may contain:
- `page.tsx` — the page itself
- `layout.tsx` — local layout (rare)
- `actions.ts` — Server Actions for this route
- `_components/` — components used only by this route (underscore prefix = private to Next)
- `_lib/` — helpers used only by this route

Shared components in `/components/`. Shared logic in `/lib/`.

## CSS / Styling

- **Tailwind only.** No CSS modules, no styled-components.
- Use design tokens, never raw hex:
  ```tsx
  ✅ className="bg-brand-600 text-white"
  ❌ className="bg-[#1e5b8f] text-[#ffffff]"
  ```
- **Logical CSS properties** (RTL-aware):
  ```tsx
  ✅ className="ms-3 ps-4 border-s-2"   // start (works in LTR and RTL)
  ❌ className="ml-3 pl-4 border-l-2"   // breaks in RTL
  ```
- Custom utility classes (`.btn-primary`, `.field`, `.card`, etc.) defined in `app/globals.css`. Reuse them; don't duplicate.
- One-off layout: inline Tailwind classes. Repeated patterns: extract to a utility class in `globals.css` or a component.

## Database & Naming

- **Database fields**: `snake_case` (matches Postgres convention).
- **TypeScript / application code**: `camelCase`.
- Map at the data access layer:
  ```ts
  // lib/repos/invitations.ts
  function toInvitation(row: DbInvitationRow): Invitation { ... }
  ```
- **Enum values in DB**: `snake_case` (`'officials'`, `'main_officials_jordanian'`).
- **Enum values in TS**: match the DB. Don't translate to PascalCase.

## API Conventions

- Server Actions return:
  - On success: `{ ok: true, data: T }`
  - On failure: `{ ok: false, error: string, code?: string }`
- Throw exceptions only for truly unexpected failures. Use return types for expected failures (validation, not found, etc.).
- Validate all input with Zod. Never trust client input.

## Authorization

- Use the `requireRole(role)` helper in every Server Action:
  ```ts
  export async function deleteInvitation(id: string) {
    await requireRole("owner"); // throws 403 if not owner
    // ...
  }
  ```
- Anonymous endpoints (public respondent flow) validate the invitation token via `validateToken()`.
- Never assume RLS catches everything — defence in depth.

## Data Access (Repos) — PII Tables

PII-bearing tables are accessed only through `lib/repos/*.ts` helpers. The repo picks the base table or its redacted view based on the caller's role:

```ts
// lib/repos/invitations.ts
async function getInvitation(id: string): Promise<Invitation> {
  const role = await getCurrentAdminRole(); // 'owner' | 'readonly'
  const source = role === "owner" ? "invitations" : "invitations_redacted";
  const { data } = await supabase.from(source).select("*").eq("id", id).single();
  return toInvitation(data);
}
```

Rules:
- Repos are **required** for: `invitations`, `recordings`, `consent_records`. Pages and Server Actions MUST NOT call `supabase.from('invitations')` (etc.) directly for these tables.
- Repos are **not required** for non-PII tables — `questions`, `tags`, `response_tags`, `researcher_notes`, `questionnaire_versions`, `notifications`, `notification_preferences`, `email_templates`, `settings`, and read access to `audit_log` may call Supabase directly.
- The repo also handles snake_case → camelCase mapping (see "Database & Naming").
- This is defence in depth on top of RLS: even if a future RLS bug exposes PII columns, the repo layer still serves the redacted view to Read-only admins.
- Add new entries to the "required" list above as the schema grows.

## Audit Logging

Every admin mutation logs to `audit_log`:
```ts
await audit.log({
  action: "invitation.created",
  resource: `Invitation ${refCode}`,
  severity: "info",
  metadata: { ref_code: refCode, category, version_id }
});
```

Standard action namespaces in `SCHEMA.md` under `audit_log`. Don't invent new ones without checking.

## Encryption

- PII fields use the `encrypt()` / `decrypt()` helpers in `lib/encryption.ts`.
- Never store decrypted values. Decrypt on read, immediately use, never log.
- The encryption key lives in `ENCRYPTION_KEY` env var; managed by Supabase Vault in production.

## Errors

- **User-facing errors**: friendly, actionable. No stack traces.
- **Console.error** for unexpected failures, with enough context to debug.
- **Sentry** (optional, post-launch) for production error tracking.

## i18n

- All user-facing strings go through the `t` object in `lib/i18n.ts`:
  ```tsx
  ✅ <button>{t.submit[lang]}</button>
  ❌ <button>Submit</button>
  ```
- Both `en` and `ar` must be filled for every key. Lint will fail on missing translations (TODO: write that lint rule).
- Numbers and dates: use `Intl` APIs with the current `lang`:
  ```ts
  new Date().toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB")
  ```

## Testing

For a thesis project, exhaustive automated testing is overkill. Minimum bar:

- **Type checking**: `npm run typecheck` must pass before commit.
- **Lint**: `npm run lint` must pass before commit.
- **Manual smoke test** of the affected flow after every Session.
- **Smoke test script**: a Playwright script that walks the full respondent flow + admin login + key dashboard loads. Runs in CI on PR.

We're not writing unit tests for individual components. We're writing integration tests for critical flows only.

## Git

- Branch off `main` for any non-trivial change: `feat/notifications`, `fix/audio-upload`, etc.
- Commit messages: imperative mood, short summary first line, blank line, optional details.
  ```
  Add bulk import validation preview

  Show row-by-row breakdown with detected actions (create vs link)
  and warnings for emails/phones found in transcripts.
  ```
- Squash-merge PRs to `main`.
- Vercel auto-deploys `main` to production. Be deliberate about merging.

## Environment Variables

Define every var in `.env.example` with a comment explaining what it is. Never commit `.env.local`.

Required vars:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # server-only, never expose
RESEND_API_KEY=
ENCRYPTION_KEY=                    # 32-byte base64; for pgcrypto column encryption
OPENAI_API_KEY=                    # optional, only for Whisper transcription
NEXT_PUBLIC_SITE_URL=              # e.g., https://karasneh-research.org
```

## Comments

- Comment **why**, not **what**. Code shows what; only the reasoning is non-obvious.
- TODO comments okay, but add an issue link or owner: `// TODO(sura): refine after pilot V2`.
- Block comments for non-trivial functions explaining purpose and gotchas.

## Reference Code Pattern

Anonymous reference codes follow this pattern: `{CATEGORY_PREFIX}-{NATIONALITY_PREFIX}-{SEQ}`.

- Officials Jordanian: `OFF-J-NN`
- Officials Syrian: `OFF-S-NN`
- Researchers: `RES-J-NN` (or `RES-NN` if nationality not applicable)
- NGOs: `NGO-J-NN`
- Donors: `DON-NN` (no nationality)

`NN` is a zero-padded incrementing integer per category. Generate atomically (DB sequence per category) to avoid collision.

## Things We Deliberately Don't Do

- **No global state library** (Redux, Zustand, etc.). Server Components + Server Actions cover our needs.
- **No CSS-in-JS**. Tailwind only.
- **No tRPC**. Server Actions are simpler.
- **No ORM** (Prisma, Drizzle). Supabase client + raw types is enough for this scale.
- **No internationalization libraries**. Our `t` object is 50 keys; we don't need i18next.
- **No GraphQL**. REST + Server Actions covers everything.
- **No microservices**. One Next.js app. One database.

Keep it boring. Boring is maintainable.
