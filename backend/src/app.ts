import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { env } from './config/env.ts'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts'
import {
  defaultLoginRateLimiter,
  defaultResendRateLimiter,
  type LoginRateLimiter,
} from './lib/rateLimit.ts'
import { getDbPool } from './lib/db.ts'
import { healthRouter } from './routes/health.ts'
import { createAuthRouter } from './routes/auth.ts'
import { createSchoolsRouter } from './routes/schools.ts'
import { createDbAuthService, type AuthService } from './services/auth.ts'
import { createEmailService, type EmailService } from './services/email.ts'

export type AppServices = {
  auth: AuthService
  loginRateLimiter: LoginRateLimiter
  resendRateLimiter: LoginRateLimiter
  emailService: EmailService
}

/**
 * Builds the Express application. No database connection is opened here.
 * Services can be injected (tests pass an in-memory AuthService and a
 * memory EmailService); the default is the Neon-backed implementation with
 * a lazy pool accessor plus the env-selected email transport.
 */
export function createApp(services?: Partial<AppServices>): Express {
  const authService = services?.auth ?? createDbAuthService(() => getDbPool())
  const loginRateLimiter = services?.loginRateLimiter ?? defaultLoginRateLimiter
  const resendRateLimiter = services?.resendRateLimiter ?? defaultResendRateLimiter
  const emailService =
    services?.emailService ??
    createEmailService(env.emailTransport, { isProduction: env.isProduction })

  const app = express()

  app.disable('x-powered-by')

  // Behind Vercel's proxy (and any reverse proxy) so req.protocol/req.ip
  // reflect the original client request.
  app.set('trust proxy', 1)

  app.use(helmet())

  // credentials: true so the frontend can send the HttpOnly session cookie
  // cross-origin; the origin callback still allow-lists exact origins.
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (no Origin header) and configured origins.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true)
          return
        }
        callback(null, false)
      },
      credentials: true,
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use('/api', healthRouter)
  app.use(
    '/api',
    createAuthRouter({
      auth: authService,
      loginRateLimiter,
      resendRateLimiter,
      emailService,
    }),
  )
  app.use('/api', createSchoolsRouter({ auth: authService }))

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

/**
 * Default export used by Vercel's zero-configuration Express detection
 * (recognized entry: src/app.ts). Vercel bundles this app as a single
 * Function; locally, src/index.ts listens on a port with the same app.
 */
const app = createApp()

export default app
