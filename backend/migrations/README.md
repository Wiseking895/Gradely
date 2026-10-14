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

The directory intentionally starts with **no migration files**. The full
Gradely school data model is introduced in a later phase; the removed
schema files contained no models, so no equivalent SQL could be derived
from them.
