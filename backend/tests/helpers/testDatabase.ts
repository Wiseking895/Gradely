import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Pool } from 'pg'
import { createDbPool } from '../../src/lib/db.ts'

/**
 * Shared migration-aware helper for database integration tests.
 *
 * Safety:
 *  - TEST_DATABASE_URL is REQUIRED. There is no fallback to DATABASE_URL or
 *    DIRECT_URL, so a forgotten variable can never silently point tests at the
 *    application/production database.
 *  - The resolved database name must look disposable (test/scratch/tmp), and
 *    NODE_ENV=production is rejected.
 *  - The public schema is dropped and recreated, so the target is destroyed.
 *
 * The helper discovers every migration in backend/migrations/ at runtime and
 * applies it in ascending filename order. It never hard-codes the list.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
)
const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/

export type TestDatabase = {
  pool: Pool
  migrationFiles: string[]
  close: () => Promise<void>
}

export async function loadMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort()
}

function assertDisposableScratchTarget(connectionString: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run destructive database tests with NODE_ENV=production')
  }

  let parsed: URL
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid PostgreSQL connection URL')
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!/(test|scratch|tmp)/i.test(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName || '(empty)'}": the database name must contain "test", "scratch", or "tmp"`,
    )
  }
}

async function applyMigrations(pool: Pool, files: string[]): Promise<void> {
  await pool.query(`
    CREATE TABLE schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  for (const file of files) {
    const sql = (await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')).trim()
    if (!sql) {
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
        file,
      ])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Test migration ${file} failed and was rolled back: ${message}`, {
        cause: error,
      })
    } finally {
      client.release()
    }
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for database integration tests. ' +
        'Point it at a disposable scratch database; there is intentionally no fallback.',
    )
  }

  assertDisposableScratchTarget(connectionString)

  const files = await loadMigrationFiles()
  if (files.length === 0) {
    throw new Error('No migration files found in backend/migrations/')
  }

  const pool = createDbPool(connectionString)
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await applyMigrations(pool, files)
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }

  return {
    pool,
    migrationFiles: files,
    close: () => pool.end(),
  }
}
