import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../config/env.ts'
import { createDbPool } from '../lib/db.ts'

/**
 * Lightweight SQL migration runner for Gradely (no ORM).
 *
 * - Files live in backend/migrations/ and are named NNNN_description.sql
 *   (zero-padded, applied in ascending order).
 * - Each file is applied atomically: BEGIN → file SQL → record version →
 *   COMMIT. Any failure rolls the whole file back.
 * - Applied versions are tracked in the schema_migrations table.
 * - Connection: DIRECT_URL (Neon direct/non-pooler endpoint — recommended
 *   for migrations) falling back to DATABASE_URL.
 *
 * Never run this against a shared or production database without approval.
 *
 * Usage:
 *   npm run db:migrate           # apply pending migrations
 *   npm run db:migrate:status    # show pending/applied without changing anything
 */

const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../migrations',
)

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/

async function loadMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR).catch(() => [] as string[])
  return entries.filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort()
}

async function appliedVersions(pool: ReturnType<typeof createDbPool>): Promise<Set<string>> {
  const exists = await pool.query("SELECT to_regclass('schema_migrations') AS name")
  if (exists.rows[0]?.name === null || exists.rows[0]?.name === undefined) {
    return new Set()
  }
  const result = await pool.query('SELECT version FROM schema_migrations')
  return new Set(result.rows.map((row: { version: string }) => row.version))
}

async function ensureTrackingTable(pool: ReturnType<typeof createDbPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function applyMigrations(pool: ReturnType<typeof createDbPool>): Promise<void> {
  await ensureTrackingTable(pool)
  const applied = await appliedVersions(pool)
  const files = await loadMigrationFiles()

  let appliedNow = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`)
      continue
    }

    const sql = (await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')).trim()
    if (!sql) {
      console.log(`skip   ${file} (empty file, not recorded)`)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
      appliedNow += 1
      console.log(`apply  ${file}`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Migration ${file} failed and was rolled back: ${message}`, {
        cause: error,
      })
    } finally {
      client.release()
    }
  }

  console.log(
    `Done. ${appliedNow} applied, ${files.length - appliedNow} already applied, ${files.length} total.`,
  )
}

async function showStatus(pool: ReturnType<typeof createDbPool>): Promise<void> {
  const applied = await appliedVersions(pool)
  const files = await loadMigrationFiles()

  if (files.length === 0) {
    console.log('No migration files found in backend/migrations/.')
    return
  }

  for (const file of files) {
    console.log(`${applied.has(file) ? 'applied' : 'pending'}   ${file}`)
  }
  const pending = files.filter((file) => !applied.has(file)).length
  console.log(`${files.length - pending} applied, ${pending} pending.`)
}

async function main(): Promise<void> {
  const connectionString = env.DIRECT_URL ?? env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'No connection string. Set DATABASE_URL (or DIRECT_URL for the Neon direct endpoint) before running migrations.',
    )
  }

  const pool = createDbPool(connectionString)
  const statusOnly = process.argv.includes('--status')

  try {
    if (statusOnly) {
      await showStatus(pool)
    } else {
      await applyMigrations(pool)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
