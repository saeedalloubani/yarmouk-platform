# Yarmouk Study — Research Platform

## What This Is

A bilingual (EN/AR) research questionnaire and qualitative-analysis platform for a master's thesis in Water Diplomacy. Evaluates the 1987 Yarmouk Agreement between Jordan and Syria.

- **Owner**: Sura Karasneh (researcher, MSc candidate)
- **Supervisors (Read-only admins)**: Dr. Mutawakkil Obeidat, Dr. Virginia Tice
- **Respondents**: invited experts across 4 categories (Officials, Researchers, Donors, NGOs); Officials split by nationality (Jordanian, Syrian)

## Repo

- **GitHub**: `github.com/saeedalloubani/yarmouk-platform`
- **Production domain (planned)**: `karasneh-research.org`
- **Hosting**: Vercel (auto-deploy from `main`)
- **Database**: Supabase Postgres
- **Email**: Resend

## Tech Stack

- **Next.js 15** App Router + TypeScript
- **Tailwind CSS v3** with custom WDC-inspired palette (see `tailwind.config.ts`)
- **Supabase** for Postgres, auth (magic-link for admins), file storage (encrypted)
- **Resend** for transactional email
- **Server Actions + Route Handlers** for all mutations; no separate API server
- **Zod** for validation everywhere a form or external input is involved
- **React Hook Form** for complex forms

### Key NPM packages

| Package | Purpose |
|---|---|
| `@supabase/supabase-js`, `@supabase/ssr` | DB + auth |
| `resend` | Email sending |
| `zod`, `react-hook-form` | Forms & validation |
| `exceljs` | ATLAS.ti `.xlsx` export |
| `pdf-lib` | PDF generation (reports, exports) |
| `docx` | Word generation |
| `@vercel/og` | PNG dashboard snapshots (server-rendered) |
| `puppeteer` | Server-side rendering for PDF dashboard exports (final choice TBD — see STATUS Session 7) |
| `mammoth` | Parse uploaded `.docx` transcripts |

## Architecture Decisions (one-liners — see `docs/DECISIONS.md` for full reasoning)

- **Tokens, not accounts, for respondents.** Each invitee gets a single-use link.
- **Encryption at column level** for any personally identifying field. Uses Supabase Vault key.
- **Anonymization is enforced at the API layer**, not just the UI. Read-only admins receive 403 on PII fields.
- **One active version per questionnaire variant** at a time. Publishing V2 atomically closes V1 and migrates non-submitted invitees.
- **Required-answer validation** on the questionnaire — respondents cannot skip questions; question map locks future questions until current is answered.
- **Transcripts (not audio) are what enters the analytical dataset.** Audio is Owner-only; the published anonymized transcript counts toward stats and gets exported to ATLAS.ti.
- **Server-side ATLAS.ti export** generates a properly formatted `.xlsx` with column prefixes ATLAS.ti's Survey Import recognizes.

## Run It Locally

```bash
# 1. Install
npm install

# 2. Environment — copy and fill
cp .env.example .env.local
# Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ENCRYPTION_KEY

# 3. Dev server
npm run dev
# → http://localhost:3000

# 4. Lint + typecheck before commit
npm run lint
npm run typecheck

# 5. Build (also runs in CI on Vercel)
npm run build
```

## Database

Schema in `supabase/migrations/*.sql`. Apply with:

```bash
# After installing Supabase CLI
supabase link --project-ref <your-project-ref>
supabase db push
```

Full schema documented in `docs/SCHEMA.md`. Seed data (Pilot V1 · Officials questionnaire) in `supabase/seed.sql`.

## Project Structure

```
app/
  (public)/                Respondent-facing routes (no auth)
    page.tsx               Landing + language picker
    consent/page.tsx       Informed consent
    questionnaire/page.tsx Single-question paginated flow
    submitted/page.tsx     Thank you
  r/[token]/route.ts       Token → set cookie → redirect to /
  admin/                   All admin routes (auth required via middleware)
    layout.tsx             Sidebar + top header (with NotificationsBell)
    page.tsx               Overview
    invitations/
    responses/
      page.tsx             List
      [id]/page.tsx        Detail with tagging panel
    questionnaires/        Version management
    analytics/
      questions/           Per-question pivot
      themes/              Tags
      timeline/            Operational chart
      demographics/        Cross-tabs
      feedback/            Pilot feedback hub
    exports/               Export Center (incl. ATLAS.ti, Executive Report)
    import/                Bulk import from Excel
    email/                 Templates + configuration
    security/              Audit log (OWNER ONLY — enforced in middleware)
    settings/              Team, notifications, retention, backup
    login/                 Magic-link entry
  api/                     Route handlers for things that can't be Server Actions

components/
  ExportMenu.tsx           Reusable PNG/PDF/Word dropdown
  NotificationsBell.tsx    Header bell + dropdown

lib/
  supabase/                Browser + server client factories
  auth.ts                  Admin role guards
  encryption.ts            Encrypt/decrypt PII columns
  i18n.ts                  EN/AR translation strings
  atlasti.ts               ATLAS.ti .xlsx generator
  exports/                 PDF, DOCX, PNG generators
  notifications.ts         Trigger in-app + email notifications
  audit.ts                 Append to audit_log

supabase/
  migrations/              SQL migrations
  seed.sql                 Initial data (Pilot V1 questions, etc.)
```

## Conventions (see `docs/CONVENTIONS.md`)

- TypeScript everywhere. No `any` unless commented why.
- Server Components by default; mark `"use client"` only where needed.
- Tailwind for all styles. Use the design tokens (`brand-*`, `accent-*`, `ink`, `muted`, etc.) — never raw hex.
- Use logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`) so RTL works.
- Database fields: `snake_case`. TypeScript / API: `camelCase`. Type generation should bridge them.
- Filenames: lowercase with dashes for routes, PascalCase for components.
- Every admin mutation calls `audit.log()` before returning.

## Current Status

If you're picking up the project cold, start with **`TASK_STATE.md`** at the repo root — it's the session-handoff snapshot: where we are, what's done, what's next, key decisions, concrete values (project ref, Vault secret names, etc.), and lessons learned the hard way.

`docs/STATUS.md` has the session-by-session build status. `docs/DECISIONS.md` has the full decision history (D1-D40). `docs/CONVENTIONS.md` has the conventions. `RUNBOOK.md` has manual ops (Vault key lifecycle).

## Don't Relitigate

`docs/DECISIONS.md` records every meaningful decision and the reasoning. If something seems wrong, check there first — it probably isn't.
