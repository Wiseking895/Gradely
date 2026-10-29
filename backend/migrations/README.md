# Gradely SQL migrations

Plain-SQL migrations applied by the lightweight runner in
`src/scripts/migrate.ts` (no ORM).

## Conventions

- Filename: `NNNN_description.sql` — four-digit zero-padded sequence plus a
  lowercase snake_case description, e.g. `0001_add_schools.sql`.
- Files are applied in ascending filename order.
- **Do not include `BEGIN`/`COMMIT` in the file** — the runner wraps every
  file in its own transaction and records the version atomically.
- Applied versions are tracked in the `schema_migrations` table (created
  automatically on first apply).
- Each file is applied exactly once; never edit a migration that has already
  been applied — add a new file instead.

## Commands (run from backend/)

```bash
npm run db:migrate          # apply pending migrations (normal mode)
npm run db:migrate:status   # list applied/pending (read-only)
npm run db:migrate -- --scratch
npm run db:migrate:status -- --scratch
```

Normal mode connects with `MIGRATION_DATABASE_URL`, then `DIRECT_URL` (the
Neon **direct**, non-`-pooler` endpoint), then `DATABASE_URL`. Any
non-loopback target requires the explicit `--allow-remote` confirmation flag.

Scratch mode (`--scratch` or `GRADELY_ENV=scratch`) requires
`SCRATCH_DATABASE_URL`, validates a loopback host and exact scratch database
name, and verifies the connected database/role before writing. It never falls
back to `DIRECT_URL` or `DATABASE_URL`, and it never loads `backend/.env`.
Select a scratch-only file explicitly:

```powershell
$env:GRADELY_ENV = 'scratch'
$env:GRADELY_ENV_FILE = "$env:APPDATA\Gradely\scratch.env"
npm run db:migrate:status -- --scratch
```

Never run migrations against a shared or production database without explicit
approval.

## Current state

| File | Purpose |
| --- | --- |
| `0001_auth_foundation.sql` | Schools, users (scrypt password hashes), school memberships (school-scoped roles), and server-side sessions (SHA-256 token hashes). Platform admin is the `users.is_platform_admin` flag, separate from school roles. |
| `0002_email_verification.sql` | Adds `users.email_verified_at`, backfills existing accounts as verified, and creates `email_verification_tokens` (SHA-256 hashes only, `consumed_at` for single use, `expires_at` for expiry). The lifecycle note in this file predates the explicit pending states; `0003` supersedes it. |
| `0003_school_verification_lifecycle.sql` | Allows `schools.status = 'pending_verification'` and `school_memberships.status = 'pending'`; verification is the only transition to `active`. Adds a partial unique index allowing at most one unconsumed verification token per user. |
| `0004_school_management.sql` | Adds school profile fields, the 14-row `class_levels` catalogue, and composite school-scoped `school_classes`, `class_sections`, `subjects`, and `class_subjects` tables. |

All four are intended to be applied to a disposable scratch PostgreSQL
database first through `npm run db:migrate` and are exercised by the
fail-closed integration tests (`TEST_DATABASE_URL`). They have **not** been
applied to production in this phase. Apply them to a scratch database first,
then production only with explicit approval.
