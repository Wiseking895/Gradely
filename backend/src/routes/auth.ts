import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { SESSION_COOKIE_NAME } from '../lib/cookies.ts'
import { HttpError } from '../lib/httpError.ts'
import { verifyPassword, verifyPasswordDummy } from '../lib/passwords.ts'
import type { LoginRateLimiter } from '../lib/rateLimit.ts'
import {
  createRequireAuth,
  requireTrustedOrigin,
} from '../middleware/auth.ts'
import type { AuthService } from '../services/auth.ts'
import { SESSION_TTL_MS } from '../services/auth.ts'

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(200),
})

const COOKIE_MAX_AGE_MS = SESSION_TTL_MS

export function createAuthRouter(deps: {
  auth: AuthService
  loginRateLimiter: LoginRateLimiter
}): Router {
  const { auth, loginRateLimiter: rateLimiter } = deps
  const requireAuth = createRequireAuth(auth)
  const trustedOrigin = requireTrustedOrigin(env.corsOrigins)

  const authRouter = Router()
  authRouter.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  /**
   * POST /api/auth/login — email + password → server-side session cookie.
   *
   * - Unknown email and wrong password return the identical 401 message and
   *   equivalent scrypt work (no account enumeration, no timing oracle).
   * - Disabled accounts only reveal their status after a *correct* password.
   * - Rate limited per IP+email; 429 with Retry-After once exceeded.
   */
  authRouter.post(
    '/auth/login',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const body = loginBodySchema.parse(req.body)
        const ip = req.ip ?? 'unknown'
        const rateKey = `${ip}|${body.email}`

        const decision = rateLimiter.check(rateKey)
        if (!decision.allowed) {
          res.set('Retry-After', String(decision.retryAfterSeconds))
          throw new HttpError(429, 'Too many login attempts. Please try again later.')
        }

        const user = await auth.findUserByEmail(body.email)
        const passwordOk = user
          ? await verifyPassword(body.password, user.passwordHash)
          : await verifyPasswordDummy(body.password)

        if (!user || !passwordOk) {
          rateLimiter.recordFailure(rateKey)
          throw new HttpError(401, 'Invalid email or password')
        }

        if (user.status === 'disabled') {
          throw new HttpError(403, 'Account is disabled')
        }

        rateLimiter.clear(rateKey)
        const { token, expiresAt } = await auth.createSession(user.id, {
          userAgent: req.headers['user-agent'],
        })
        void auth.touchLastLogin(user.id).catch((error: unknown) => {
          console.error('Failed to record last_login_at:', error)
        })

        res.cookie(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          secure: env.isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: COOKIE_MAX_AGE_MS,
        })

        res.status(200).json({
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isPlatformAdmin: user.isPlatformAdmin,
          },
          expiresAt: expiresAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/auth/logout — revokes the session and clears the cookie. */
  authRouter.post('/auth/logout', trustedOrigin, async (req, res, next) => {
    try {
      if (req.sessionToken) {
        await auth.revokeSession(req.sessionToken)
      }
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'lax',
        path: '/',
      })
      res.status(200).json({ status: 'ok' })
    } catch (error) {
      next(error)
    }
  })

  /** GET /api/auth/me — current user + active school memberships. */
  authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
    try {
      const session = req.auth!
      const memberships = await auth.listActiveMemberships(session.user.id)
      res.status(200).json({
        user: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
          isPlatformAdmin: session.user.isPlatformAdmin,
        },
        session: { expiresAt: session.expiresAt.toISOString() },
        memberships,
      })
    } catch (error) {
      next(error)
    }
  })

  return authRouter
}
