import { Router } from 'express'
import {
  authorizeSchoolAccess,
  createRequireAuth,
  requireVerifiedEmail,
} from '../middleware/auth.ts'
import type { AuthService } from '../services/auth.ts'

/**
 * School-scoped routes. Every handler derives access from the authenticated
 * user's server-side memberships — a school ID in the URL is only a lookup
 * key and grants nothing by itself.
 *
 * All routes additionally require a verified email address
 * (requireVerifiedEmail): unverified administrators can sign in and reach
 * /api/auth/me (to see their state and resend), but cannot use protected
 * school features until they verify.
 */
export function createSchoolsRouter(deps: { auth: AuthService }): Router {
  const requireAuth = createRequireAuth(deps.auth)

  const schoolsRouter = Router()

  /** GET /api/schools/mine — the caller's active memberships only. */
  schoolsRouter.get(
    '/schools/mine',
    requireAuth,
    requireVerifiedEmail,
    async (req, res, next) => {
      try {
        const session = req.auth!
        const memberships = await deps.auth.listActiveMemberships(session.user.id)
        res.status(200).json({ memberships })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/schools/:schoolId — school details for members (any active
   * role) or, explicitly, for platform administrators. Non-members receive
   * the same 404 as a non-existent school.
   */
  schoolsRouter.get(
    '/schools/:schoolId',
    requireAuth,
    requireVerifiedEmail,
    async (req, res, next) => {
      try {
        const session = req.auth!
        const rawSchoolId = req.params.schoolId
        const schoolId = Array.isArray(rawSchoolId)
          ? (rawSchoolId[0] ?? '')
          : (rawSchoolId ?? '')
        const access = await authorizeSchoolAccess({
          auth: deps.auth,
          userId: session.user.id,
          isPlatformAdmin: session.user.isPlatformAdmin,
          schoolId,
          allowedRoles: ['school_admin', 'teacher'],
          allowPlatformAdmin: true,
        })
        res.status(200).json({ school: access.school, role: access.role })
      } catch (error) {
        next(error)
      }
    },
  )

  return schoolsRouter
}
