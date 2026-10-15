import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { createLoginRateLimiter } from '../src/lib/rateLimit.ts'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.ts'
import {
  createFakeAuthService,
  type FakeAuthService,
} from './helpers/fakeAuthService.ts'

const PASSWORD = 'Sup3r-Secret-Password!'

function sessionCookieFrom(response: request.Response): string {
  const cookies = response.headers['set-cookie'] as string[] | undefined
  const sessionCookie = cookies?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!sessionCookie) {
    throw new Error('expected a session cookie on the response')
  }
  return sessionCookie
}

describe('auth HTTP flow', () => {
  let auth: FakeAuthService

  beforeEach(() => {
    auth = createFakeAuthService()
  })

  it('logs in with valid credentials, sets a hardened cookie, and returns the user', async () => {
    const user = await auth.seedUser({
      email: 'teacher@school.test',
      password: PASSWORD,
      displayName: 'Tina Teacher',
    })
    const app = createApp({ auth })

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'teacher@school.test', password: PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.user).toEqual({
      id: user.id,
      email: 'teacher@school.test',
      displayName: 'Tina Teacher',
      isPlatformAdmin: false,
    })
    expect(response.body.user).not.toHaveProperty('passwordHash')

    const cookie = sessionCookieFrom(response)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    // NODE_ENV=test is not production, so Secure must be absent for the
    // cookie to work over plain http in tests.
    expect(cookie).not.toContain('Secure')
  })

  it('rejects wrong passwords and unknown emails with the identical 401', async () => {
    await auth.seedUser({
      email: 'teacher@school.test',
      password: PASSWORD,
      displayName: 'Tina Teacher',
    })
    const app = createApp({ auth })

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'teacher@school.test', password: 'wrong-password' })
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@school.test', password: PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body.message).toBe('Invalid email or password')
    expect(unknownEmail.body.message).toBe('Invalid email or password')
    expect(wrongPassword.headers['set-cookie']).toBeUndefined()
    expect(unknownEmail.headers['set-cookie']).toBeUndefined()
  })

  it('rejects disabled accounts with 403 only after a correct password', async () => {
    await auth.seedUser({
      email: 'disabled@school.test',
      password: PASSWORD,
      displayName: 'Dan Disabled',
      status: 'disabled',
    })
    const app = createApp({ auth })

    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'disabled@school.test', password: 'wrong' })
    const right = await request(app)
      .post('/api/auth/login')
      .send({ email: 'disabled@school.test', password: PASSWORD })

    expect(wrong.status).toBe(401) // no existence leak for bad passwords
    expect(right.status).toBe(403)
    expect(right.body.message).toBe('Account is disabled')
    expect(right.headers['set-cookie']).toBeUndefined()
  })

  it('returns validation errors for missing or malformed fields', async () => {
    const app = createApp({ auth })

    const missing = await request(app).post('/api/auth/login').send({})
    const badEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'x' })

    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('Validation failed')
    expect(Array.isArray(missing.body.issues)).toBe(true)
    expect(badEmail.status).toBe(400)
  })

  it('serves /api/auth/me for the session and after logout invalidates it', async () => {
    const user = await auth.seedUser({
      email: 'admin@school.test',
      password: PASSWORD,
      displayName: 'Ada Admin',
      isPlatformAdmin: true,
    })
    const school = auth.seedSchool({ name: 'Ada School' })
    auth.seedMembership({ userId: user.id, school, role: 'school_admin' })
    const app = createApp({ auth })
    const agent = request.agent(app)

    const anonymous = await agent.get('/api/auth/me')
    expect(anonymous.status).toBe(401)

    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'admin@school.test', password: PASSWORD })
    expect(login.status).toBe(200)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('admin@school.test')
    expect(me.body.user.isPlatformAdmin).toBe(true)
    expect(me.body.memberships).toHaveLength(1)
    expect(me.body.memberships[0]).toMatchObject({
      schoolId: school.id,
      schoolName: 'Ada School',
      role: 'school_admin',
    })
    expect(me.headers['cache-control']).toBe('no-store')

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(200)

    const afterLogout = await agent.get('/api/auth/me')
    expect(afterLogout.status).toBe(401)
    expect(auth.sessionCount()).toBe(1) // revoked, not deleted
  })

  it('rate limits repeated failures with 429 and Retry-After', async () => {
    await auth.seedUser({
      email: 'teacher@school.test',
      password: PASSWORD,
      displayName: 'Tina Teacher',
    })
    const app = createApp({
      auth,
      loginRateLimiter: createLoginRateLimiter({ maxAttempts: 3, windowMs: 60_000 }),
    })

    for (let i = 0; i < 3; i += 1) {
      const failed = await request(app)
        .post('/api/auth/login')
        .send({ email: 'teacher@school.test', password: 'wrong' })
      expect(failed.status).toBe(401)
    }

    const limited = await request(app)
      .post('/api/auth/login')
      .send({ email: 'teacher@school.test', password: PASSWORD })
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
  })

  it('rejects browser cross-origin login attempts from untrusted origins', async () => {
    const app = createApp({ auth })

    const evil = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@y.test', password: 'x' })
    const trusted = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'x@y.test', password: 'x' })

    expect(evil.status).toBe(403)
    // Trusted origin still gets the normal credential check (401, not 403).
    expect(trusted.status).toBe(401)
  })
})
