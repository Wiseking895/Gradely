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

These files have **not** been run against any database in this phase. Apply
them to a scratch database first (integration tests run against
`TEST_DATABASE_URL`), then production only with explicit approval.
