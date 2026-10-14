import { Router } from 'express'
import { env } from '../config/env.ts'
import { checkDatabase } from '../lib/db.ts'

export const healthRouter = Router()

/**
 * Liveness/health check. Intentionally does not touch the database so the
 * API can be started and monitored without PostgreSQL being reachable.
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'gradely-api',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database: 'not checked by /api/health (see /api/health/db)',
  })
})

/**
 * Database health check, deliberately separate from /api/health so liveness
 * never depends on credentials or a reachable database. Runs a read-only
 * `SELECT 1`; returns a safe 503 (no error details, no connection strings)
 * when DATABASE_URL is unset or PostgreSQL is unreachable.
 */
healthRouter.get('/health/db', async (_req, res) => {
  const up = await checkDatabase()
  if (up) {
    res.status(200).json({ status: 'ok', database: 'up' })
    return
  }
  res.status(503).json({ status: 'unavailable', database: 'down' })
})
