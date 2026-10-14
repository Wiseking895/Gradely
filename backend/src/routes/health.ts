import { Router } from 'express'
import { env } from '../config/env.ts'

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
    database: 'not checked by /api/health',
  })
})
