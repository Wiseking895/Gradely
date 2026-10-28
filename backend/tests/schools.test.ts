import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.ts'
import { SchoolManagementError } from '../src/services/schools.ts'
import {
  createFakeAuthService,
  type FakeAuthService,
} from './helpers/fakeAuthService.ts'
import type { SchoolRecord } from '../src/services/auth.ts'
import {
  createFakeLogoStorage,
  type FakeLogoStorage,
} from './helpers/fakeLogoStorage.ts'
import {
  createFakeSchoolService,
  makeProfile,
  type FakeSchoolService,
} from './helpers/fakeSchoolService.ts'

const PASSWORD = 'Sup3r-Secret-Password!'
const TRUSTED_ORIGIN = 'http://localhost:5173'

type TestContext = {
  auth: FakeAuthService
  schools: FakeSchoolService
  logoStorage: FakeLogoStorage
  app: ReturnType<typeof createApp>
  school: SchoolRecord
  schoolId: string
  adminCookie: string
  adminId: string
}

async function cookieFor(auth: FakeAuthService, userId: string): Promise<string> {
  const { token } = await auth.createSession(userId)
  return `${SESSION_COOKIE_NAME}=${token}`
}

async function setup(options: { schoolStatus?: string } = {}): Promise<TestContext> {
  const auth = createFakeAuthService()
  const school = auth.seedSchool({
    name: 'Bright Future School',
    slug: 'bright-future-school',
    status: options.schoolStatus ?? 'active',
  })
  const admin = await auth.seedUser({
    email: 'admin@bright.test',
    password: PASSWORD,
    displayName: 'Ada Admin',
  })
  auth.seedMembership({
    userId: admin.id,
    school,
    role: 'school_admin',
    status: 'active',
  })

  const schools = createFakeSchoolService({
    school: makeProfile({
      id: school.id,
      name: school.name,
      slug: school.slug,
      status: school.status,
    }),
  })
  const logoStorage = createFakeLogoStorage()
  const app = createApp({ auth, schools, logoStorage })
  return {
    auth,
    schools,
    logoStorage,
    app,
    school,
    schoolId: school.id,
    adminId: admin.id,
    adminCookie: await cookieFor(auth, admin.id),
  }
}

describe('school management HTTP authorization and validation', () => {
  let context: TestContext

  beforeEach(async () => {
    vi.clearAllMocks()
    context = await setup()
  })

  it('requires authentication and verified email before school management', async () => {
    const anonymous = await request(context.app).get(
      `/api/schools/${context.schoolId}/overview`,
    )
    expect(anonymous.status).toBe(401)

    const unverified = await context.auth.seedUser({
      email: 'pending@bright.test',
      password: PASSWORD,
      displayName: 'Pending Admin',
      emailVerified: false,
    })
    context.auth.seedMembership({
      userId: unverified.id,
      school: context.auth.seedSchool({
        name: 'Pending School',
        slug: 'pending-school',
      }),
      role: 'school_admin',
      status: 'active',
    })
    const pendingCookie = await cookieFor(context.auth, unverified.id)
    const pending = await request(context.app)
      .get(`/api/schools/${context.schoolId}/overview`)
      .set('Cookie', pendingCookie)
    expect(pending.status).toBe(403)
    expect(pending.body.code).toBe('email_verification_required')
  })

  it('returns 403 for teachers and a non-leaking 404 for cross-school access', async () => {
    const teacher = await context.auth.seedUser({
      email: 'teacher@bright.test',
      password: PASSWORD,
      displayName: 'Tina Teacher',
    })
    context.auth.seedMembership({
      userId: teacher.id,
      school: context.school,
      role: 'teacher',
      status: 'active',
    })
    const teacherCookie = await cookieFor(context.auth, teacher.id)

    const forbidden = await request(context.app)
      .get(`/api/schools/${context.schoolId}/overview`)
      .set('Cookie', teacherCookie)
    expect(forbidden.status).toBe(403)

    const otherSchool = context.auth.seedSchool({
      name: 'Other School',
      slug: 'other-school',
    })
    const crossSchool = await request(context.app)
      .get(`/api/schools/${otherSchool.id}/overview`)
      .set('Cookie', context.adminCookie)
    expect(crossSchool.status).toBe(404)
    expect(crossSchool.body.message).toBe('School not found')
    expect(crossSchool.body).not.toHaveProperty('school')
  })

  it('allows platform-admin reads and rejects platform-admin writes', async () => {
    const platform = await context.auth.seedUser({
      email: 'platform@gradely.test',
      password: PASSWORD,
      displayName: 'Platform Admin',
      isPlatformAdmin: true,
    })
    const platformCookie = await cookieFor(context.auth, platform.id)

    const read = await request(context.app)
      .get(`/api/schools/${context.schoolId}/overview`)
      .set('Cookie', platformCookie)
    expect(read.status).toBe(200)
    expect(read.body.role).toBe('platform_admin')
    expect(read.body.canManage).toBe(false)

    const write = await request(context.app)
      .patch(`/api/schools/${context.schoolId}/profile`)
      .set('Cookie', platformCookie)
      .send({ name: 'Nope' })
    expect(write.status).toBe(404)
    expect(context.schools.updateProfile).not.toHaveBeenCalled()
  })

  it('blocks suspended/archived schools for members but allows platform oversight', async () => {
    const suspended = await setup({ schoolStatus: 'suspended' })
    const memberRead = await request(suspended.app)
      .get(`/api/schools/${suspended.schoolId}/overview`)
      .set('Cookie', suspended.adminCookie)
    expect(memberRead.status).toBe(404)

    const platform = await suspended.auth.seedUser({
      email: 'oversight@gradely.test',
      password: PASSWORD,
      displayName: 'Oversight',
      isPlatformAdmin: true,
    })
    const platformCookie = await cookieFor(suspended.auth, platform.id)
    const platformRead = await request(suspended.app)
      .get(`/api/schools/${suspended.schoolId}/overview`)
      .set('Cookie', platformCookie)
    expect(platformRead.status).toBe(200)
  })

  it('enforces trusted Origin on every management write', async () => {
    const response = await request(context.app)
      .patch(`/api/schools/${context.schoolId}/profile`)
      .set('Cookie', context.adminCookie)
      .set('Origin', 'https://evil.example')
      .send({ name: 'Changed' })
    expect(response.status).toBe(403)
    expect(context.schools.updateProfile).not.toHaveBeenCalled()

    const accepted = await request(context.app)
      .patch(`/api/schools/${context.schoolId}/profile`)
      .set('Cookie', context.adminCookie)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'Changed' })
    expect(accepted.status).toBe(200)
    expect(context.schools.updateProfile).toHaveBeenCalledWith(
      context.schoolId,
      { name: 'Changed' },
    )
  })

  it('rejects unknown and empty profile fields with validation errors', async () => {
    const unknown = await request(context.app)
      .patch(`/api/schools/${context.schoolId}/profile`)
      .set('Cookie', context.adminCookie)
      .send({ name: 'Changed', slug: 'hacked' })
    expect(unknown.status).toBe(400)

    const empty = await request(context.app)
      .patch(`/api/schools/${context.schoolId}/profile`)
      .set('Cookie', context.adminCookie)
      .send({})
    expect(empty.status).toBe(400)
  })

  it('returns levels in the required order and shapes class creation responses', async () => {
    const levels = await request(context.app)
      .get(`/api/schools/${context.schoolId}/class-levels`)
      .set('Cookie', context.adminCookie)
    expect(levels.status).toBe(200)
    expect(levels.body.levels.map((level: { label: string }) => level.label)).toEqual([
      'Creche',
      'Nursery 1',
      'Nursery 2',
      'KG 1',
      'KG 2',
      'Basic 1',
      'Basic 2',
      'Basic 3',
      'Basic 4',
      'Basic 5',
      'Basic 6',
      'JHS 1',
      'JHS 2',
      'JHS 3',
    ])

    const created = await request(context.app)
      .post(`/api/schools/${context.schoolId}/classes`)
      .set('Cookie', context.adminCookie)
      .send({ levelCode: 'basic_1' })
    expect(created.status).toBe(201)
    expect(created.body.class.id).toBeTruthy()

    vi.mocked(context.schools.createClass).mockRejectedValueOnce(
      new SchoolManagementError(
        409,
        'class_already_exists',
        'A class already exists for that school level',
      ),
    )
    const duplicate = await request(context.app)
      .post(`/api/schools/${context.schoolId}/classes`)
      .set('Cookie', context.adminCookie)
      .send({ levelCode: 'basic_1' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('class_already_exists')
  })

  it('returns a non-leaking 404 when a class detail is not in the authorized school', async () => {
    vi.mocked(context.schools.getClassDetail).mockResolvedValueOnce(null)
    const response = await request(context.app)
      .get(
        `/api/schools/${context.schoolId}/classes/00000000-0000-4000-8000-000000000000`,
      )
      .set('Cookie', context.adminCookie)
    expect(response.status).toBe(404)
    expect(response.body.code).toBe('class_not_found')
  })

  it('validates logo upload signing, HEAD verification, and never exposes the key', async () => {
    const initiated = await request(context.app)
      .post(`/api/schools/${context.schoolId}/logo/uploads`)
      .set('Cookie', context.adminCookie)
      .send({ contentType: 'image/png', fileSizeBytes: 1024 })
    expect(initiated.status).toBe(201)
    expect(initiated.body.uploadUrl).toBe('https://r2.test/upload')
    expect(initiated.body.uploadId).toBeTruthy()
    expect(JSON.stringify(initiated.body)).not.toContain('logo_key')
    expect(context.logoStorage.createUpload).toHaveBeenCalledWith({
      schoolId: context.schoolId,
      uploadId: initiated.body.uploadId,
      contentType: 'image/png',
    })

    const uploadId = '00000000-0000-4000-8000-000000000001'
    context.logoStorage.setHead({
      contentType: 'image/png',
      contentLength: 1024,
    })
    const completed = await request(context.app)
      .post(`/api/schools/${context.schoolId}/logo`)
      .set('Cookie', context.adminCookie)
      .send({ uploadId, contentType: 'image/png' })
    expect(completed.status).toBe(200)
    expect(completed.body.logo.url).toBe('https://r2.test/download')
    expect(JSON.stringify(completed.body)).not.toContain('logo_key')
    expect(context.schools.setLogo).toHaveBeenCalledWith(
      context.schoolId,
      `school-logos/${context.schoolId}/${uploadId}.png`,
      'image/png',
    )

    context.logoStorage.setHead(null)
    const incomplete = await request(context.app)
      .post(`/api/schools/${context.schoolId}/logo`)
      .set('Cookie', context.adminCookie)
      .send({ uploadId, contentType: 'image/png' })
    expect(incomplete.status).toBe(400)
    expect(incomplete.body.code).toBe('logo_upload_incomplete')

    context.logoStorage.setHead({
      contentType: 'image/png',
      contentLength: 2 * 1024 * 1024 + 1,
    })
    const oversized = await request(context.app)
      .post(`/api/schools/${context.schoolId}/logo`)
      .set('Cookie', context.adminCookie)
      .send({ uploadId, contentType: 'image/png' })
    expect(oversized.status).toBe(400)
    expect(oversized.body.code).toBe('logo_upload_invalid')
  })

  it('returns 503 when logo storage is unavailable and omits logo keys from overview', async () => {
    context.logoStorage.configured = false
    const unavailable = await request(context.app)
      .post(`/api/schools/${context.schoolId}/logo/uploads`)
      .set('Cookie', context.adminCookie)
      .send({ contentType: 'image/jpeg', fileSizeBytes: 1024 })
    expect(unavailable.status).toBe(503)
    // 5xx responses deliberately withhold internal error codes and details.
    expect(unavailable.body.error).toBe('Internal server error')
    expect(unavailable.body).not.toHaveProperty('code')

    vi.mocked(context.schools.getOverview).mockResolvedValueOnce({
      ...context.schools.defaultOverview,
      school: { ...context.schools.defaultProfile, hasLogo: true },
    })
    const overview = await request(context.app)
      .get(`/api/schools/${context.schoolId}/overview`)
      .set('Cookie', context.adminCookie)
    expect(overview.status).toBe(200)
    expect(overview.body.school.logo.storageAvailable).toBe(false)
    expect(overview.body.school.logo.url).toBeNull()
    expect(JSON.stringify(overview.body)).not.toContain('logo_key')
  })
})
