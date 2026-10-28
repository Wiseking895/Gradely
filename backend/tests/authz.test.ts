import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { HttpError } from '../src/lib/httpError.ts'
import { authorizeSchoolAccess } from '../src/middleware/auth.ts'
import {
  createFakeAuthService,
  type FakeAuthService,
} from './helpers/fakeAuthService.ts'

const PASSWORD = 'Sup3r-Secret-Password!'

describe('school isolation (HTTP)', () => {
  let auth: FakeAuthService
  let app: ReturnType<typeof createApp>
  let agentA: ReturnType<typeof request.agent>
  let agentB: ReturnType<typeof request.agent>
  let agentPlatform: ReturnType<typeof request.agent>
  let userA: { id: string }
  let schoolA: { id: string }
  let schoolB: { id: string }

  beforeEach(async () => {
    auth = createFakeAuthService()
    app = createApp({ auth })

    userA = await auth.seedUser({
      email: 'a@school.test',
      password: PASSWORD,
      displayName: 'User A',
    })
    const userB = await auth.seedUser({
      email: 'b@school.test',
      password: PASSWORD,
      displayName: 'User B',
    })
    await auth.seedUser({
      email: 'root@gradely.test',
      password: PASSWORD,
      displayName: 'Root',
      isPlatformAdmin: true,
    })

    schoolA = auth.seedSchool({ name: 'School A' })
    schoolB = auth.seedSchool({ name: 'School B' })
    auth.seedMembership({ userId: userA.id, school: schoolA, role: 'school_admin' })
    auth.seedMembership({ userId: userB.id, school: schoolB, role: 'teacher' })

    agentA = request.agent(app)
    agentB = request.agent(app)
    agentPlatform = request.agent(app)
    await agentA
      .post('/api/auth/login')
      .send({ email: 'a@school.test', password: PASSWORD })
    await agentB
      .post('/api/auth/login')
      .send({ email: 'b@school.test', password: PASSWORD })
    await agentPlatform
      .post('/api/auth/login')
      .send({ email: 'root@gradely.test', password: PASSWORD })
  })

  it('lets a member read their own school', async () => {
    const response = await agentA.get(`/api/schools/${schoolA.id}`)
    expect(response.status).toBe(200)
    expect(response.body.school).toMatchObject({ id: schoolA.id, name: 'School A' })
    expect(response.body.role).toBe('school_admin')
  })

  it('denies School B access to a School A user who swaps the ID in the URL', async () => {
    const response = await agentA.get(`/api/schools/${schoolB.id}`)
    // Uniform 404 (not 403) so school IDs cannot be enumerated.
    expect(response.status).toBe(404)
    expect(response.body.message).toBe('School not found')
    expect(JSON.stringify(response.body)).not.toContain('School B')
  })

  it('returns 404 for malformed school IDs and unknown schools', async () => {
    const malformed = await agentA.get('/api/schools/not-a-uuid')
    const unknown = await agentA.get(
      '/api/schools/00000000-0000-4000-8000-000000000000',
    )
    expect(malformed.status).toBe(404)
    expect(unknown.status).toBe(404)
  })

  it('requires authentication for school endpoints', async () => {
    const anonymous = await request(app).get(`/api/schools/${schoolA.id}`)
    expect(anonymous.status).toBe(401)
  })

  it('lists only the caller’s own memberships in /api/schools/mine', async () => {
    const mineA = await agentA.get('/api/schools/mine')
    expect(mineA.status).toBe(200)
    expect(mineA.body.memberships).toHaveLength(1)
    expect(mineA.body.memberships[0].schoolId).toBe(schoolA.id)

    const mineB = await agentB.get('/api/schools/mine')
    expect(mineB.body.memberships).toHaveLength(1)
    expect(mineB.body.memberships[0].schoolId).toBe(schoolB.id)
  })

  it('allows platform administrators explicitly, marking role platform_admin', async () => {
    const response = await agentPlatform.get(`/api/schools/${schoolB.id}`)
    expect(response.status).toBe(200)
    expect(response.body.role).toBe('platform_admin')
  })

  it('does not treat platform admin as a school membership shortcut elsewhere', async () => {
    // Platform admin with no membership still only sees membership listings
    // they legitimately have (none) — no phantom school memberships appear.
    const mine = await agentPlatform.get('/api/schools/mine')
    expect(mine.status).toBe(200)
    expect(mine.body.memberships).toHaveLength(0)
  })

  it.each(['suspended', 'archived'] as const)(
    'denies an active member access to a %s school (uniform 404)',
    async (status) => {
      const school = auth.seedSchool({ name: `${status} school`, status })
      auth.seedMembership({
        userId: userA.id,
        school,
        role: 'school_admin',
        status: 'active',
      })

      const response = await agentA.get(`/api/schools/${school.id}`)
      expect(response.status).toBe(404)
      expect(response.body.message).toBe('School not found')
      expect(JSON.stringify(response.body)).not.toContain(school.name)
    },
  )

  it('denies a teacher access to another school', async () => {
    const response = await agentB.get(`/api/schools/${schoolA.id}`)
    expect(response.status).toBe(404)
    expect(response.body.message).toBe('School not found')
  })

  it('denies a teacher whose school is suspended', async () => {
    const school = auth.seedSchool({ name: 'Suspended Teacher School', status: 'suspended' })
    auth.seedMembership({ userId: userA.id, school, role: 'teacher', status: 'active' })

    const response = await agentA.get(`/api/schools/${school.id}`)
    expect(response.status).toBe(404)
  })

  it('still lets an explicit platform admin read suspended and archived schools', async () => {
    for (const status of ['suspended', 'archived'] as const) {
      const school = auth.seedSchool({ name: `${status} review school`, status })
      const response = await agentPlatform.get(`/api/schools/${school.id}`)
      expect(response.status).toBe(200)
      expect(response.body.role).toBe('platform_admin')
      expect(response.body.school).toMatchObject({ id: school.id, status })
    }
  })

  it('uses the explicit platform path when a platform admin also has a membership in an inactive school', async () => {
    const school = auth.seedSchool({ name: 'Inactive membership school', status: 'suspended' })
    const both = await auth.seedUser({
      email: 'both@gradely.test',
      password: PASSWORD,
      displayName: 'Both Roles',
      isPlatformAdmin: true,
    })
    auth.seedMembership({
      userId: both.id,
      school,
      role: 'school_admin',
      status: 'active',
    })
    const bothAgent = request.agent(app)
    await bothAgent
      .post('/api/auth/login')
      .send({ email: 'both@gradely.test', password: PASSWORD })

    const response = await bothAgent.get(`/api/schools/${school.id}`)
    expect(response.status).toBe(200)
    expect(response.body.role).toBe('platform_admin')
  })
})

describe('authorizeSchoolAccess (unit)', () => {
  it('enforces role restrictions with 403 for authorized-but-wrong roles', async () => {
    const auth = createFakeAuthService()
    const teacher = await auth.seedUser({
      email: 't@school.test',
      password: PASSWORD,
      displayName: 'Teacher',
    })
    const school = auth.seedSchool()
    auth.seedMembership({ userId: teacher.id, school, role: 'teacher' })

    await expect(
      authorizeSchoolAccess({
        auth,
        userId: teacher.id,
        isPlatformAdmin: false,
        schoolId: school.id,
        allowedRoles: ['school_admin'],
      }),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>)
  })

  it('ignores revoked memberships (404)', async () => {
    const auth = createFakeAuthService()
    const user = await auth.seedUser({
      email: 'r@school.test',
      password: PASSWORD,
      displayName: 'Revoked',
    })
    const school = auth.seedSchool()
    auth.seedMembership({ userId: user.id, school, role: 'school_admin', status: 'revoked' })

    await expect(
      authorizeSchoolAccess({
        auth,
        userId: user.id,
        isPlatformAdmin: false,
        schoolId: school.id,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('does not grant platform admins school access unless explicitly allowed', async () => {
    const auth = createFakeAuthService()
    const admin = await auth.seedUser({
      email: 'p@school.test',
      password: PASSWORD,
      displayName: 'Platform',
      isPlatformAdmin: true,
    })
    const school = auth.seedSchool()

    await expect(
      authorizeSchoolAccess({
        auth,
        userId: admin.id,
        isPlatformAdmin: true,
        schoolId: school.id,
      }),
    ).rejects.toMatchObject({ status: 404 })

    const access = await authorizeSchoolAccess({
      auth,
      userId: admin.id,
      isPlatformAdmin: true,
      schoolId: school.id,
      allowPlatformAdmin: true,
    })
    expect(access.role).toBe('platform_admin')
  })
})
