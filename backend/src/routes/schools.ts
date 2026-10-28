import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { HttpError } from '../lib/httpError.ts'
import { buildSchoolLogoObjectKey, R2_SCHOOL_LOGO_MAX_SIZE_BYTES } from '../lib/r2.ts'
import {
  authorizeSchoolAccess,
  createRequireAuth,
  isUuid,
  requireTrustedOrigin,
  requireVerifiedEmail,
  type SchoolAccess,
} from '../middleware/auth.ts'
import type { AuthService } from '../services/auth.ts'
import type { SchoolLogoStorage } from '../services/schoolLogoStorage.ts'
import type {
  ManagementStatus,
  SchoolProfile,
  SchoolService,
} from '../services/schools.ts'

const CLASS_LEVEL_CODES = [
  'creche',
  'nursery_1',
  'nursery_2',
  'kg_1',
  'kg_2',
  'basic_1',
  'basic_2',
  'basic_3',
  'basic_4',
  'basic_5',
  'basic_6',
  'jhs_1',
  'jhs_2',
  'jhs_3',
] as const

const statusSchema = z.enum(['active', 'archived'])

const emptyStringToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value

const optionalContactEmail = z
  .preprocess(
    emptyStringToNull,
    z.string().trim().toLowerCase().max(254).pipe(z.email()).nullable(),
  )
  .optional()

const optionalPhone = z
  .preprocess(emptyStringToNull, z.string().trim().min(3).max(40).nullable())
  .optional()

const optionalAddress = z
  .preprocess(emptyStringToNull, z.string().trim().min(1).max(300).nullable())
  .optional()

const profileBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    contactEmail: optionalContactEmail,
    phone: optionalPhone,
    address: optionalAddress,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required',
  })

const createClassBodySchema = z
  .object({ levelCode: z.enum(CLASS_LEVEL_CODES) })
  .strict()

const classStatusBodySchema = z.object({ status: statusSchema }).strict()

const createSectionBodySchema = z
  .object({ name: z.string().trim().min(1).max(40) })
  .strict()

const updateSectionBodySchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one section field is required',
  })

const createSubjectBodySchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict()

const updateSubjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one subject field is required',
  })

const createAssignmentBodySchema = z
  .object({ subjectId: z.uuid() })
  .strict()

const assignmentStatusBodySchema = z.object({ status: statusSchema }).strict()

const logoUploadSchema = z
  .object({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    fileSizeBytes: z
      .number()
      .int()
      .positive()
      .max(R2_SCHOOL_LOGO_MAX_SIZE_BYTES),
  })
  .strict()

const logoSchema = z
  .object({
    uploadId: z.uuid(),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  })
  .strict()

const logoUnavailable = () =>
  new HttpError(
    503,
    'School-logo storage is not configured',
    'logo_storage_unavailable',
  )

const logoStorageError = () =>
  new HttpError(
    502,
    'School-logo storage could not be reached',
    'logo_storage_error',
  )

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function childId(value: string | string[] | undefined, code: string, label: string): string {
  const id = parameter(value)
  if (!isUuid(id)) {
    throw new HttpError(404, `${label} not found`, code)
  }
  return id
}

function logoResponse(
  profile: SchoolProfile,
  url: string | null,
  storageAvailable: boolean,
) {
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    status: profile.status,
    contactEmail: profile.contactEmail,
    phone: profile.phone,
    address: profile.address,
    logo: {
      url,
      updatedAt: profile.logoUpdatedAt,
      storageAvailable,
    },
    profileCompletedAt: profile.profileCompletedAt,
    setupCompletedAt: profile.setupCompletedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function createSchoolsRouter(deps: {
  auth: AuthService
  schools: SchoolService
  logoStorage: SchoolLogoStorage
}): Router {
  const requireAuth = createRequireAuth(deps.auth)
  const trustedOrigin = requireTrustedOrigin(env.corsOrigins)

  const schoolsRouter = Router()
  schoolsRouter.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  // Scope authentication to /api/schools/*; a router-wide guard would turn the
  // application's normal unmatched-route 404 into a 401.
  schoolsRouter.use('/schools', requireAuth, requireVerifiedEmail)

  async function accessFor(
    req: Request,
    allowPlatformAdmin: boolean,
  ): Promise<SchoolAccess> {
    const session = req.auth!
    return authorizeSchoolAccess({
      auth: deps.auth,
      userId: session.user.id,
      isPlatformAdmin: session.user.isPlatformAdmin,
      schoolId: parameter(req.params.schoolId),
      allowedRoles: ['school_admin'],
      allowPlatformAdmin,
    })
  }

  async function profilePayload(
    schoolId: string,
    profile: SchoolProfile,
  ) {
    let url: string | null = null
    let storageAvailable = deps.logoStorage.isConfigured()

    if (profile.hasLogo && storageAvailable) {
      try {
        const logo = await deps.schools.getLogo(schoolId)
        if (logo) {
          url = await deps.logoStorage.presignDownload(logo.key)
        } else {
          storageAvailable = false
        }
      } catch {
        url = null
        storageAvailable = false
      }
    }

    return logoResponse(profile, url, storageAvailable)
  }

  /** GET /api/schools/mine — the caller's active memberships only. */
  schoolsRouter.get('/schools/mine', async (req, res, next) => {
    try {
      const session = req.auth!
      const memberships = await deps.auth.listActiveMemberships(session.user.id)
      res.status(200).json({ memberships })
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/schools/:schoolId — Phase A school details for members or,
   * explicitly, platform administrators. Preserved for existing clients.
   */
  schoolsRouter.get('/schools/:schoolId', async (req, res, next) => {
    try {
      const session = req.auth!
      const access = await authorizeSchoolAccess({
        auth: deps.auth,
        userId: session.user.id,
        isPlatformAdmin: session.user.isPlatformAdmin,
        schoolId: parameter(req.params.schoolId),
        allowedRoles: ['school_admin', 'teacher'],
        allowPlatformAdmin: true,
      })
      res.status(200).json({ school: access.school, role: access.role })
    } catch (error) {
      next(error)
    }
  })

  /** GET /api/schools/:schoolId/overview */
  schoolsRouter.get('/schools/:schoolId/overview', async (req, res, next) => {
    try {
      const access = await accessFor(req, true)
      const overview = await deps.schools.getOverview(access.school.id)
      if (!overview) {
        throw new HttpError(404, 'School not found', 'school_not_found')
      }
      const school = await profilePayload(access.school.id, overview.school)
      res.status(200).json({
        role: access.role,
        canManage: access.role === 'school_admin',
        school,
        setup: overview.setup,
      })
    } catch (error) {
      next(error)
    }
  })

  /** GET /api/schools/:schoolId/class-levels */
  schoolsRouter.get('/schools/:schoolId/class-levels', async (req, res, next) => {
    try {
      await accessFor(req, true)
      const levels = await deps.schools.listLevels()
      res.status(200).json({ levels })
    } catch (error) {
      next(error)
    }
  })

  /** GET /api/schools/:schoolId/classes */
  schoolsRouter.get('/schools/:schoolId/classes', async (req, res, next) => {
    try {
      const access = await accessFor(req, true)
      const classes = await deps.schools.listClasses(access.school.id)
      res.status(200).json({ classes })
    } catch (error) {
      next(error)
    }
  })

  /** GET /api/schools/:schoolId/classes/:classId */
  schoolsRouter.get(
    '/schools/:schoolId/classes/:classId',
    async (req, res, next) => {
      try {
        const access = await accessFor(req, true)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const detail = await deps.schools.getClassDetail(access.school.id, classId)
        if (!detail) {
          throw new HttpError(404, 'Class not found', 'class_not_found')
        }
        res.status(200).json(detail)
      } catch (error) {
        next(error)
      }
    },
  )

  /** GET /api/schools/:schoolId/subjects */
  schoolsRouter.get('/schools/:schoolId/subjects', async (req, res, next) => {
    try {
      const access = await accessFor(req, true)
      const subjects = await deps.schools.listSubjects(access.school.id)
      res.status(200).json({ subjects })
    } catch (error) {
      next(error)
    }
  })

  /** PATCH /api/schools/:schoolId/profile */
  schoolsRouter.patch(
    '/schools/:schoolId/profile',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const body = profileBodySchema.parse(req.body)
        const profile = await deps.schools.updateProfile(access.school.id, body)
        const school = await profilePayload(access.school.id, profile)
        res.status(200).json({ school })
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/schools/:schoolId/classes */
  schoolsRouter.post(
    '/schools/:schoolId/classes',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const body = createClassBodySchema.parse(req.body)
        const schoolClass = await deps.schools.createClass(
          access.school.id,
          body.levelCode,
        )
        res.status(201).json({ class: schoolClass })
      } catch (error) {
        next(error)
      }
    },
  )

  /** PATCH /api/schools/:schoolId/classes/:classId */
  schoolsRouter.patch(
    '/schools/:schoolId/classes/:classId',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const body = classStatusBodySchema.parse(req.body)
        const schoolClass = await deps.schools.updateClassStatus(
          access.school.id,
          classId,
          body.status as ManagementStatus,
        )
        res.status(200).json({ class: schoolClass })
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/schools/:schoolId/classes/:classId/sections */
  schoolsRouter.post(
    '/schools/:schoolId/classes/:classId/sections',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const body = createSectionBodySchema.parse(req.body)
        const section = await deps.schools.createSection(
          access.school.id,
          classId,
          body.name,
        )
        res.status(201).json({ section })
      } catch (error) {
        next(error)
      }
    },
  )

  /** PATCH /api/schools/:schoolId/classes/:classId/sections/:sectionId */
  schoolsRouter.patch(
    '/schools/:schoolId/classes/:classId/sections/:sectionId',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const sectionId = childId(
          req.params.sectionId,
          'section_not_found',
          'Section',
        )
        const body = updateSectionBodySchema.parse(req.body)
        const section = await deps.schools.updateSection(
          access.school.id,
          classId,
          sectionId,
          body,
        )
        res.status(200).json({ section })
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/schools/:schoolId/subjects */
  schoolsRouter.post(
    '/schools/:schoolId/subjects',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const body = createSubjectBodySchema.parse(req.body)
        const subject = await deps.schools.createSubject(
          access.school.id,
          body.name,
        )
        res.status(201).json({ subject })
      } catch (error) {
        next(error)
      }
    },
  )

  /** PATCH /api/schools/:schoolId/subjects/:subjectId */
  schoolsRouter.patch(
    '/schools/:schoolId/subjects/:subjectId',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const subjectId = childId(
          req.params.subjectId,
          'subject_not_found',
          'Subject',
        )
        const body = updateSubjectBodySchema.parse(req.body)
        const subject = await deps.schools.updateSubject(
          access.school.id,
          subjectId,
          body,
        )
        res.status(200).json({ subject })
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/schools/:schoolId/classes/:classId/subjects */
  schoolsRouter.post(
    '/schools/:schoolId/classes/:classId/subjects',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const body = createAssignmentBodySchema.parse(req.body)
        const result = await deps.schools.createAssignment(
          access.school.id,
          classId,
          body.subjectId,
        )
        res.status(result.created ? 201 : 200).json({
          assignment: result.assignment,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /** PATCH /api/schools/:schoolId/classes/:classId/subjects/:subjectId */
  schoolsRouter.patch(
    '/schools/:schoolId/classes/:classId/subjects/:subjectId',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const classId = childId(req.params.classId, 'class_not_found', 'Class')
        const subjectId = childId(
          req.params.subjectId,
          'subject_not_found',
          'Subject',
        )
        const body = assignmentStatusBodySchema.parse(req.body)
        const assignment = await deps.schools.updateAssignmentStatus(
          access.school.id,
          classId,
          subjectId,
          body.status as ManagementStatus,
        )
        res.status(200).json({ assignment })
      } catch (error) {
        next(error)
      }
    },
  )

  /** GET /api/schools/:schoolId/logo — fresh presigned download URL. */
  schoolsRouter.get('/schools/:schoolId/logo', async (req, res, next) => {
    try {
      const access = await accessFor(req, true)
      if (!deps.logoStorage.isConfigured()) {
        throw logoUnavailable()
      }
      const logo = await deps.schools.getLogo(access.school.id)
      if (!logo) {
        throw new HttpError(404, 'No school logo is set', 'logo_not_found')
      }
      const url = await deps.logoStorage.presignDownload(logo.key)
      res.status(200).json({
        logo: {
          url,
          updatedAt: logo.updatedAt,
          storageAvailable: true,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  /** POST /api/schools/:schoolId/logo/uploads — presign a direct R2 PUT. */
  schoolsRouter.post(
    '/schools/:schoolId/logo/uploads',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        if (!deps.logoStorage.isConfigured()) {
          throw logoUnavailable()
        }
        const body = logoUploadSchema.parse(req.body)
        const uploadId = randomUUID()
        try {
          const upload = await deps.logoStorage.createUpload({
            schoolId: access.school.id,
            uploadId,
            contentType: body.contentType,
          })
          res.status(201).json({
            uploadId,
            uploadUrl: upload.url,
            expiresAt: upload.expiresAt,
            contentType: body.contentType,
            maxSizeBytes: R2_SCHOOL_LOGO_MAX_SIZE_BYTES,
          })
        } catch (error) {
          if (error instanceof HttpError) {
            throw error
          }
          throw logoStorageError()
        }
      } catch (error) {
        next(error)
      }
    },
  )

  /** POST /api/schools/:schoolId/logo — HEAD-verify then persist. */
  schoolsRouter.post(
    '/schools/:schoolId/logo',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        if (!deps.logoStorage.isConfigured()) {
          throw logoUnavailable()
        }
        const body = logoSchema.parse(req.body)
        const key = buildSchoolLogoObjectKey({
          schoolId: access.school.id,
          uploadId: body.uploadId,
          contentType: body.contentType,
        })

        const head = await deps.logoStorage.head(key).catch(() => {
          throw logoStorageError()
        })
        if (!head) {
          throw new HttpError(
            400,
            'The uploaded logo could not be found',
            'logo_upload_incomplete',
          )
        }
        if (
          head.contentType !== body.contentType ||
          head.contentLength === undefined ||
          !Number.isInteger(head.contentLength) ||
          head.contentLength <= 0 ||
          head.contentLength > R2_SCHOOL_LOGO_MAX_SIZE_BYTES
        ) {
          throw new HttpError(
            400,
            'The uploaded logo failed server-side type or size verification',
            'logo_upload_invalid',
          )
        }

        const replaced = await deps.schools.setLogo(
          access.school.id,
          key,
          body.contentType,
        )
        if (replaced.previousKey && replaced.previousKey !== key) {
          try {
            await deps.logoStorage.delete(replaced.previousKey)
          } catch {
            console.error('Failed to delete the previous school-logo object')
          }
        }

        let url: string | null = null
        let storageAvailable = true
        try {
          url = await deps.logoStorage.presignDownload(replaced.logo.key)
        } catch {
          storageAvailable = false
        }

        res.status(200).json({
          logo: {
            url,
            updatedAt: replaced.logo.updatedAt,
            storageAvailable,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /** DELETE /api/schools/:schoolId/logo — soft clear + best-effort cleanup. */
  schoolsRouter.delete(
    '/schools/:schoolId/logo',
    trustedOrigin,
    async (req, res, next) => {
      try {
        const access = await accessFor(req, false)
        const previous = await deps.schools.clearLogo(access.school.id)
        if (previous && deps.logoStorage.isConfigured()) {
          try {
            await deps.logoStorage.delete(previous)
          } catch {
            console.error('Failed to delete the removed school-logo object')
          }
        }
        res.status(200).json({
          logo: {
            url: null,
            updatedAt: null,
            storageAvailable: deps.logoStorage.isConfigured(),
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return schoolsRouter
}
