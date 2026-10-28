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
npm run db:migrate          # apply pending migrations
npm run db:migrate:status   # list applied/pending (read-only)
```

The runner connects with `DIRECT_URL` if set (the Neon **direct**, non-
`-pooler` endpoint — Neon's recommendation for schema changes), otherwise
`DATABASE_URL`. Never run migrations against a shared or production database
without explicit approval.

## Current state

| File | Purpose |
| --- | --- |
| `0001_auth_foundation.sql` | Schools, users (scrypt password hashes), school memberships (school-scoped roles), and server-side sessions (SHA-256 token hashes). Platform admin is the `users.is_platform_admin` flag, separate from school roles. |
| `0002_email_verification.sql` | Adds `users.email_verified_at`, backfills existing accounts as verified, and creates `email_verification_tokens` (SHA-256 hashes only, `consumed_at` for single use, `expires_at` for expiry). The lifecycle note in this file predates the explicit pending states; `0003` supersedes it. |
| `0003_school_verification_lifecycle.sql` | Allows `schools.status = 'pending_verification'` and `school_memberships.status = 'pending'`; verification is the only transition to `active`. Adds a partial unique index allowing at most one unconsumed verification token per user. |

All three have been applied to a disposable scratch PostgreSQL database
through `npm run db:migrate` and are exercised by the gated integration tests
(`TEST_DATABASE_URL`). They have **not** been applied to production. Apply
them to a scratch database first, then production only with explicit
approval.
