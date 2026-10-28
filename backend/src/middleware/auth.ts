import type { RequestHandler } from 'express'
import { readSessionCookie } from '../lib/cookies.ts'
import { HttpError } from '../lib/httpError.ts'
import type {
  AuthService,
  MembershipWithSchool,
  SchoolRole,
} from '../services/auth.ts'

/**
 * Authentication middleware and school-isolation authorization helpers.
 *
 * Design rules enforced here:
 *  - The authenticated user and their school access ALWAYS come from the
 *    server-side session record. A school ID or role supplied by the client
 *    is never trusted; it is only used as a *lookup key* against the user's
 *    verified memberships.
 *  - Platform administrators use the explicit is_platform_admin flag via
 *    requirePlatformAdmin / allowPlatformAdmin — never a school membership
 *    shortcut.
 *  - School-scoped lookups return a uniform 404 whether the school does not
 *    exist or the caller simply lacks access, so IDs cannot be enumerated.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function createRequireAuth(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const token = readSessionCookie(req.headers.cookie)
    if (!token) {
      next(new HttpError(401, 'Authentication required'))
      return
    }

    auth
      .getSessionUser(token)
      .then((session) => {
        if (!session) {
          next(new HttpError(401, 'Authentication required'))
          return
        }
        if (session.user.status === 'disabled') {
          next(new HttpError(403, 'Account is disabled'))
          return
        }
        req.auth = session
        req.sessionToken = token
        next()
      })
      .catch(next)
  }
}

/** Explicit platform-level authorization (separate from school roles). */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new HttpError(401, 'Authentication required'))
    return
  }
  if (!req.auth.user.isPlatformAdmin) {
    next(new HttpError(403, 'Platform administrator access required'))
    return
  }
  next()
}

/**
 * Blocks protected school features until the account's email is verified
 * (users.email_verified_at IS NOT NULL). Placed AFTER requireAuth so it only
 * applies to authenticated sessions; /api/auth/me intentionally stays
 * reachable so clients can show the verification state and resend UI.
 * Does not apply to platform-level access checks (bootstrap-created admins
 * are marked verified by migration 0002 / npm run admin:create).
 */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new HttpError(401, 'Authentication required'))
    return
  }
  if (!req.auth.user.emailVerified) {
    next(
      new HttpError(
        403,
        'Email verification required to access school features',
        'email_verification_required',
      ),
    )
    return
  }
  next()
}

/**
 * Guards state-changing auth endpoints against cross-origin abuse from
 * browsers. Requests without an Origin header (curl, native clients,
 * Supertest) are allowed; browsers always send Origin on cross-origin POSTs.
 */
export function requireTrustedOrigin(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(origin)) {
      next(new HttpError(403, 'Origin not allowed'))
      return
    }
    next()
  }
}

export type SchoolAccess = {
  school: MembershipWithSchool['school']
  role: SchoolRole | 'platform_admin'
}

export async function authorizeSchoolAccess(params: {
  auth: AuthService
  userId: string
  isPlatformAdmin: boolean
  schoolId: string
  allowedRoles?: readonly SchoolRole[]
  allowPlatformAdmin?: boolean
}): Promise<SchoolAccess> {
  const { auth, userId, isPlatformAdmin, schoolId, allowedRoles } = params

  if (!isUuid(schoolId)) {
    throw new HttpError(404, 'School not found')
  }

  const membership = await auth.findActiveMembership(userId, schoolId)
  // An active membership alone is not enough: a suspended or archived school
  // (or one still awaiting verification) grants no school-scoped access, even
  // to members whose membership row is still 'active'. Platform administrators
  // fall through to the explicit platform path below.
  if (membership && membership.school.status === 'active') {
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new HttpError(403, 'You do not have permission to perform this action')
    }
    return { school: membership.school, role: membership.role }
  }

  if (isPlatformAdmin && params.allowPlatformAdmin === true) {
    const school = await auth.findSchoolById(schoolId)
    if (school) {
      return { school, role: 'platform_admin' }
    }
  }

  // Uniform response for "does not exist" and "you cannot see this".
  throw new HttpError(404, 'School not found')
}
