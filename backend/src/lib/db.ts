import { Pool } from 'pg'
import { env } from '../config/env.ts'

let pool: Pool | undefined

/**
 * Creates a PostgreSQL pool with the shared Gradely settings.
 *
 * - Neon requires TLS: `sslmode=require` is part of the Neon connection
 *   string, and pg parses it (sslmode=require is treated as verify-full —
 *   full certificate verification — in pg 8.23).
 * - A small pool plus connection/idle timeouts fits Vercel's per-instance
 *   serverless model, where each warm function instance owns its own pool.
 */
export function createDbPool(connectionString: string): Pool {
  const newPool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })

  // Idle clients can fail (network blips, Neon endpoint restarts). pg surfaces
  // those as pool 'error' events; without a listener they would crash the
  // process. Log the message only — never connection details or credentials.
  newPool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message)
  })

  return newPool
}

/**
 * Returns the shared application pool, creating it on first use.
 *
 * - Lazy: starting the API and answering GET /api/health never opens a
 *   database connection, so no credentials are required to boot.
 * - Singleton: one pool per warm serverless instance; a new pool is never
 *   created per request.
 */
export function getDbPool(): Pool {
  if (pool === undefined) {
    if (!env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and configure your Neon PostgreSQL connection string.',
      )
    }
    pool = createDbPool(env.DATABASE_URL)
  }
  return pool
}

/**
 * Read-only connectivity probe (`SELECT 1`) with a short timeout.
 * Never throws and never leaks error details — callers only learn up/down.
 */
export async function checkDatabase(timeoutMs = 5_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs)
      timer.unref()
    })
    const result = await Promise.race([getDbPool().query('SELECT 1 AS ok'), timeout])
    return result.rows[0]?.ok === 1
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}
