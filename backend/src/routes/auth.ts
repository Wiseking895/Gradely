import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { readSessionCookie, SESSION_COOKIE_NAME } from '../lib/cookies.ts'
import { HttpError } from '../lib/httpError.ts'
import {
  hashPassword,
  verifyPassword,
  verifyPasswordDummy,
} from '../lib/passwords.ts'
import type { LoginRateLimiter } from '../lib/rateLimit.ts'
import {
  createRequireAuth,
  requireTrustedOrigin,
} from '../middleware/auth.ts'
import type { AuthService } from '../services/auth.ts'
import {
  DuplicateEmailError,
  DuplicateSchoolSlugError,
  SESSION_TTL_MS,
} from '../services/auth.ts'
import type { EmailMessage, EmailService } from '../services/email.ts'

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(200),
})

// Mirrors the DB checks in migrations 0001 (school name 2-120, slug regex,
// display name 1-120) plus a minimum password length for self-registration.
const registerSchoolBodySchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  schoolSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,62}$/,
      'Use lowercase letters, numbers and hyphens (2-63 characters, starting with a letter or number)',
    ),
  adminName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(8).max(200),
})

const verifyEmailBodySchema = z.object({
  token: z.string().trim().min(1).max(512),
})

const resendBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
})

const COOKIE_MAX_AGE_MS = SESSION_TTL_MS

/**
 * Verification links point at the frontend (first configured CORS origin,
 * e.g. http://localhost:5173 in dev or the deployed frontend in production).
 */
function appBaseUrl(): string {
  return env.corsOrigins[0] ?? 'http://localhost:5173'
}

function buildVerificationEmail(email: string, token: string): EmailMessage {
  const link = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`
  return {
    to: email,
    subject: 'Verify your email for Gradely',
    text: [
      'Welcome to Gradely!',
      '',
      'Confirm your email address to activate your school administrator account:',
      link,
      '',
      'This link expires in 24 hours and can be used once. If you did not create this account, you can ignore this email.',
    ].join('\n'),
  }
}

export function createAuthRouter(deps: {
  auth: AuthService
  loginRateLimiter: LoginRateLimiter
  resendRateLimiter: LoginRateLimiter
  emailService: EmailService
}): Router {
  const {
    auth,
    loginRateLimiter: rateLimiter,
    resendRateLimiter,
    emailService,
  } = deps
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
            emailVerified: user.emailVerified,
          },
          expiresAt: expiresAt.toISOString(),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/auth/logout — revokes the session server-side and clears the
   * cookie. The token is read straight from the request cookie (logout must
   * work even without a valid session lookup, and MUST revoke the token so a
   * stolen cookie dies with the logout). Clear attributes mirror the ones
   * used when setting the cookie in POST /auth/login (except maxAge, which
   * Express's clearCookie replaces with an expired date).
   */
  authRouter.post('/auth/logout', trustedOrigin, async (req, res, next) => {
    try {
      const token = readSessionCookie(req.headers.cookie)
      if (token) {
        await auth.revokeSession(token)
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
          emailVerified: session.user.emailVerified,
        },
        session: { expiresAt: session.expiresAt.toISOString() },
        memberships,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/auth/register-school — self-service school registration.
   *
   * Creates { school + administrator user + school_admin membership } in ONE
   * database transaction, then emails a single-use verification link.
   *
   * Security decisions:
   *  - The new administrator is ALWAYS unverified (email_verified_at NULL)
   *    and NEVER a platform administrator (is_platform_admin column is not
   *    part of the INSERT; it defaults to false).
   *  - Duplicate email / school identifier -> 409 with distinct codes. This
   *    does reveal that an identifier is taken; accepted trade-off for a
   *    registration form (documented in the Phase A report). Login and
   *    resend remain enumeration-safe.
   *  - Email delivery happens AFTER the transaction commits. On delivery
   *    failure the account still exists (unverified) and the client is told
   *    to request a new link via POST /auth/resend-verification; no raw
   *    token is ever logged.
   */
  authRouter.post(
    '/auth/register-school',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const body = registerSchoolBodySchema.parse(req.body)
        const passwordHash = await hashPassword(body.password)

        let created: { userId: string; schoolId: string }
        try {
          created = await auth.registerSchoolWithAdmin({
            schoolName: body.schoolName,
            schoolSlug: body.schoolSlug,
            email: body.email,
            displayName: body.adminName,
            passwordHash,
          })
        } catch (error) {
          if (error instanceof DuplicateEmailError) {
            res.status(409).json({
              error: 'Email already registered',
              code: 'email_taken',
              message:
                'An account with this email already exists. Sign in instead, or register with a different email.',
            })
            return
          }
          if (error instanceof DuplicateSchoolSlugError) {
            res.status(409).json({
              error: 'School identifier already in use',
              code: 'school_identifier_taken',
              message:
                'That school identifier is taken. Please choose another one.',
            })
            return
          }
          throw error
        }

        const { token } = await auth.createEmailVerificationToken(
          created.userId,
        )
        try {
          await emailService.send(buildVerificationEmail(body.email, token))
        } catch (error) {
          // Account exists but the email never went out. Log WITHOUT the
          // token; the client must use the resend endpoint.
          console.error(
            'Verification email delivery failed for',
            body.email,
            error instanceof Error ? error.message : String(error),
          )
          res.status(502).json({
            error: 'Verification email could not be sent',
            code: 'email_delivery_failed',
            message:
              'Your school and administrator account were created, but the verification email could not be sent. You can request a new link.',
          })
          return
        }

        res.status(201).json({
          status: 'verification_sent',
          user: {
            id: created.userId,
            email: body.email,
            displayName: body.adminName,
            isPlatformAdmin: false,
            emailVerified: false,
          },
          school: {
            id: created.schoolId,
            name: body.schoolName,
            slug: body.schoolSlug,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/auth/verify-email — redeem a single-use token.
   *
   * The raw token is hashed (SHA-256) and matched against
   * email_verification_tokens; consumption is atomic, so a replayed link
   * cannot verify twice. Distinct machine codes let the frontend render
   * expired / already-used / invalid states without guessing.
   */
  authRouter.post(
    '/auth/verify-email',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const body = verifyEmailBodySchema.parse(req.body)
        const outcome = await auth.consumeEmailVerificationToken(body.token)

        switch (outcome.status) {
          case 'verified':
            res.status(200).json({
              status: 'verified',
              user: {
                id: outcome.user.id,
                email: outcome.user.email,
                displayName: outcome.user.displayName,
                isPlatformAdmin: outcome.user.isPlatformAdmin,
                emailVerified: true,
              },
            })
            return
          case 'expired':
            res.status(400).json({
              error: 'Verification link has expired',
              code: 'token_expired',
              message:
                'This verification link has expired. Request a new one below.',
            })
            return
          case 'used':
            res.status(400).json({
              error: 'Verification link has already been used',
              code: 'token_used',
              message:
                'This verification link was already used. If your account is not verified yet, request a new link.',
            })
            return
          case 'invalid':
          default:
            res.status(400).json({
              error: 'Invalid verification link',
              code: 'token_invalid',
              message:
                'This verification link is not valid. Request a new one below.',
            })
            return
        }
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/auth/resend-verification — issue + email a fresh token.
   *
   * Uniform 202 for every well-formed request (unknown email, already
   * verified, disabled account, delivery failure), so this endpoint cannot
   * be used to enumerate accounts. Rate limited per IP+email; each accepted
   * attempt counts, successful or not. Resend supersedes any outstanding
   * token for the account (at most one live token per user).
   */
  authRouter.post(
    '/auth/resend-verification',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const body = resendBodySchema.parse(req.body)
        const ip = req.ip ?? 'unknown'
        const rateKey = `${ip}|${body.email}`

        const decision = resendRateLimiter.check(rateKey)
        if (!decision.allowed) {
          res.set('Retry-After', String(decision.retryAfterSeconds))
          res.status(429).json({
            error: 'Too many resend requests',
            code: 'rate_limited',
            message:
              'Too many verification emails requested. Please wait and try again.',
            retryAfterSeconds: decision.retryAfterSeconds,
          })
          return
        }
        resendRateLimiter.recordFailure(rateKey)

        const user = await auth.findUserByEmail(body.email)
        if (user && !user.emailVerified && user.status !== 'disabled') {
          try {
            const { token } = await auth.createEmailVerificationToken(user.id)
            await emailService.send(buildVerificationEmail(body.email, token))
          } catch (error) {
            // Uniform response on purpose — never reveal whether the account
            // exists or whether sending failed. Log WITHOUT the token.
            console.error(
              'Resend verification email failed for',
              body.email,
              error instanceof Error ? error.message : String(error),
            )
          }
        }

        res.status(202).json({
          status: 'pending',
          message:
            'If an account exists for that email and is not yet verified, a new verification link has been sent.',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return authRouter
}
