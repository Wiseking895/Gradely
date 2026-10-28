import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.ts'
import { createLoginRateLimiter } from '../src/lib/rateLimit.ts'
import {
  createMemoryEmailService,
  type MemoryEmailService,
} from '../src/services/email.ts'
import {
  createFakeAuthService,
  type FakeAuthService,
} from './helpers/fakeAuthService.ts'

/**
 * Phase A regression tests for the email-verification HTTP flow, exercised
 * against the real routes, middleware, cookies and password hashing (only
 * the data layer is the in-memory AuthService; the SQL implementation is
 * covered by the gated tests/auth.db.test.ts).
 */

const PASSWORD = 'Sup3r-Secret-Password!'
const REGISTER_BODY = {
  schoolName: 'Bright School',
  schoolSlug: 'bright-school',
  adminName: 'Ada Admin',
  email: 'ada@bright.test',
  password: PASSWORD,
}

function tokenFromLink(link: string): string {
  const url = new URL(link)
  const token = url.searchParams.get('token')
  if (!token) {
    throw new Error(`verification link has no token: ${link}`)
  }
  return token
}

describe('POST /api/auth/register-school', () => {
  let auth: FakeAuthService
  let email: MemoryEmailService

  beforeEach(() => {
    auth = createFakeAuthService()
    email = createMemoryEmailService()
  })

  it('creates school + admin + membership, never grants platform admin, and emails a hashed-only token', async () => {
    const app = createApp({ auth, emailService: email })

    const response = await request(app)
      .post('/api/auth/register-school')
      .send(REGISTER_BODY)

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('verification_sent')
    expect(response.body.user).toMatchObject({
      email: 'ada@bright.test',
      isPlatformAdmin: false,
      emailVerified: false,
    })
    expect(response.body.school).toMatchObject({
      name: 'Bright School',
      slug: 'bright-school',
    })

    // Consistent records: one school (pending verification), one unverified
    // non-admin user, one pending school_admin membership.
    expect(auth.schoolCount()).toBe(1)
    expect(auth.userCount()).toBe(1)
    expect(auth.membershipCount()).toBe(1)
    const stored = await auth.findUserByEmail('ada@bright.test')
    expect(stored?.isPlatformAdmin).toBe(false)
    expect(stored?.emailVerified).toBe(false)

    // Exactly one email with exactly one single-use token link.
    expect(email.outboxLength()).toBe(1)
    const message = email.lastMessage()
    expect(message?.to).toBe('ada@bright.test')
    const link = message?.text.match(/https?:\/\/\S*token=\S+/)?.[0]
    expect(link).toBeDefined()
    expect(auth.liveVerificationTokenCount()).toBe(1)
  })

  it('returns 409 email_taken for a duplicate email and leaves no extra records', async () => {
    const app = createApp({ auth, emailService: email })
    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)

    const duplicate = await request(app).post('/api/auth/register-school').send({
      ...REGISTER_BODY,
      schoolSlug: 'other-slug',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('email_taken')
    expect(auth.schoolCount()).toBe(1)
    expect(auth.userCount()).toBe(1)
    expect(email.outboxLength()).toBe(1) // no second email on conflict
  })

  it('returns 409 school_identifier_taken for a duplicate slug', async () => {
    const app = createApp({ auth, emailService: email })
    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)

    const duplicate = await request(app).post('/api/auth/register-school').send({
      ...REGISTER_BODY,
      email: 'other@bright.test',
      adminName: 'Other Admin',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('school_identifier_taken')
    expect(auth.userCount()).toBe(1)
  })

  it('rolls back all records when the data layer fails mid-registration', async () => {
    const app = createApp({ auth, emailService: email })
    auth.failNextRegistration()

    const response = await request(app)
      .post('/api/auth/register-school')
      .send(REGISTER_BODY)
    expect(response.status).toBe(500)
    expect(auth.schoolCount()).toBe(0)
    expect(auth.userCount()).toBe(0)
    expect(auth.membershipCount()).toBe(0)
    expect(email.outboxLength()).toBe(0)
  })

  it('returns 502 on email delivery failure, keeps the account, and never logs the raw token', async () => {
    const app = createApp({ auth, emailService: email })
    email.failAll()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await request(app)
        .post('/api/auth/register-school')
        .send(REGISTER_BODY)
      expect(response.status).toBe(502)
      expect(response.body.code).toBe('email_delivery_failed')

      // Account persists (unverified) so the user can request a new link.
      expect(auth.userCount()).toBe(1)
      expect(auth.schoolCount()).toBe(1)
      const stored = await auth.findUserByEmail('ada@bright.test')
      expect(stored?.emailVerified).toBe(false)

      // Logged arguments identify the failure without leaking any token.
      expect(errorSpy).toHaveBeenCalled()
      const logged = errorSpy.mock.calls.flat().map(String).join(' ')
      expect(logged).toContain('Verification email delivery failed')
      expect(logged).toContain('ada@bright.test')
      expect(logged).not.toMatch(/token=/)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('POST /api/auth/verify-email', () => {
  let auth: FakeAuthService
  let email: MemoryEmailService
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    auth = createFakeAuthService()
    email = createMemoryEmailService()
    app = createApp({ auth, emailService: email })
    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)
  })

  function registrationToken(): string {
    const link = email.lastMessage()?.text.match(/https?:\/\/\S*token=\S+/)?.[0]
    if (!link) {
      throw new Error('expected a verification link in the outbox')
    }
    return tokenFromLink(link.replace(/[.,]$/, ''))
  }

  it('verifies with a valid token and marks the user verified', async () => {
    const response = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: registrationToken() })
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('verified')
    expect(response.body.user).toMatchObject({
      email: 'ada@bright.test',
      emailVerified: true,
      isPlatformAdmin: false,
    })
    const stored = await auth.findUserByEmail('ada@bright.test')
    expect(stored?.emailVerified).toBe(true)
  })

  it('rejects a replayed token with token_used (single use)', async () => {
    const token = registrationToken()
    const first = await request(app).post('/api/auth/verify-email').send({ token })
    expect(first.status).toBe(200)

    const replay = await request(app).post('/api/auth/verify-email').send({ token })
    expect(replay.status).toBe(400)
    expect(replay.body.code).toBe('token_used')
  })

  it('rejects an unknown token with token_invalid', async () => {
    const response = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'not-a-real-token' })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('token_invalid')
  })

  it('rejects an expired token with token_expired and does not verify', async () => {
    auth.expireVerificationTokens()
    const response = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: registrationToken() })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('token_expired')
    const stored = await auth.findUserByEmail('ada@bright.test')
    expect(stored?.emailVerified).toBe(false)
  })
})

describe('POST /api/auth/resend-verification', () => {
  let auth: FakeAuthService
  let email: MemoryEmailService

  beforeEach(() => {
    auth = createFakeAuthService()
    email = createMemoryEmailService()
  })

  it('answers a uniform 202 whether or not the account exists', async () => {
    const app = createApp({ auth, emailService: email })

    const unknown = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@bright.test' })
    expect(unknown.status).toBe(202)
    expect(email.outboxLength()).toBe(0)

    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)
    email.clear()

    const known = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'ada@bright.test' })
    expect(known.status).toBe(202)
    expect(known.body.status).toBe('pending')
    expect(email.outboxLength()).toBe(1)
  })

  it('supersedes the previous token: old link dies, new link works', async () => {
    const app = createApp({ auth, emailService: email })
    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)
    const staleLink = email.lastMessage()?.text.match(/https?:\/\/\S*token=\S+/)?.[0]
    const staleToken = tokenFromLink(staleLink!.replace(/[.,]$/, ''))

    await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'ada@bright.test' })
    expect(email.outboxLength()).toBe(2)
    expect(auth.liveVerificationTokenCount()).toBe(1)

    const freshLink = email.lastMessage()?.text.match(/https?:\/\/\S*token=\S+/)?.[0]
    const freshToken = tokenFromLink(freshLink!.replace(/[.,]$/, ''))

    const stale = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: staleToken })
    expect(stale.status).toBe(400)
    expect(stale.body.code).toBe('token_invalid')

    const fresh = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: freshToken })
    expect(fresh.status).toBe(200)
  })

  it('does not send for already-verified or disabled accounts, still answering 202', async () => {
    const app = createApp({ auth, emailService: email })
    await auth.seedUser({
      email: 'verified@bright.test',
      password: PASSWORD,
      displayName: 'Vera Verified',
      emailVerified: true,
    })
    await auth.seedUser({
      email: 'disabled@bright.test',
      password: PASSWORD,
      displayName: 'Dan Disabled',
      emailVerified: false,
      status: 'disabled',
    })

    const verified = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'verified@bright.test' })
    const disabled = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'disabled@bright.test' })
    expect(verified.status).toBe(202)
    expect(disabled.status).toBe(202)
    expect(email.outboxLength()).toBe(0)
  })

  it('rate limits resend attempts with 429 and Retry-After', async () => {
    const app = createApp({
      auth,
      emailService: email,
      resendRateLimiter: createLoginRateLimiter({ maxAttempts: 2, windowMs: 60_000 }),
    })

    for (let i = 0; i < 2; i += 1) {
      const accepted = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'ada@bright.test' })
      expect(accepted.status).toBe(202)
    }

    const limited = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'ada@bright.test' })
    expect(limited.status).toBe(429)
    expect(limited.body.code).toBe('rate_limited')
    expect(limited.headers['retry-after']).toBeDefined()
  })

  it('logs resend delivery failures without the token', async () => {
    const app = createApp({ auth, emailService: email })
    await request(app).post('/api/auth/register-school').send(REGISTER_BODY)
    email.clear()
    email.failAll()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'ada@bright.test' })
      // Uniform 202: no existence or delivery-failure leak.
      expect(response.status).toBe(202)
      expect(errorSpy).toHaveBeenCalled()
      const logged = errorSpy.mock.calls.flat().map(String).join(' ')
      expect(logged).toContain('Resend verification email failed')
      expect(logged).not.toMatch(/token=/)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('unverified accounts cannot use protected school functionality', () => {
  let auth: FakeAuthService
  let email: MemoryEmailService
  let app: ReturnType<typeof createApp>
  let registration: request.Response

  beforeEach(async () => {
    auth = createFakeAuthService()
    email = createMemoryEmailService()
    app = createApp({ auth, emailService: email })
    registration = await request(app)
      .post('/api/auth/register-school')
      .send(REGISTER_BODY)
    expect(registration.status).toBe(201)
  })

  async function login(): Promise<string> {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: REGISTER_BODY.email, password: PASSWORD })
    expect(response.status).toBe(200)
    const cookies = response.headers['set-cookie'] as string[]
    const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
    return sessionCookie!.split(';')[0]
  }

  it('blocks school routes with 403 email_verification_required until verified', async () => {
    const cookie = await login()
    // The registration response carries the school ID even though the
    // pending membership is not yet visible to /auth/me or /schools.
    const schoolId = registration.body.school.id as string
    const user = await auth.findUserByEmail(REGISTER_BODY.email)
    await expect(auth.listActiveMemberships(user!.id)).resolves.toEqual([])
    expect((await auth.findSchoolById(schoolId))?.status).toBe(
      'pending_verification',
    )

    const mine = await request(app).get('/api/schools/mine').set('Cookie', cookie)
    expect(mine.status).toBe(403)
    expect(mine.body.code).toBe('email_verification_required')

    const one = await request(app)
      .get(`/api/schools/${schoolId}`)
      .set('Cookie', cookie)
    expect(one.status).toBe(403)
    expect(one.body.code).toBe('email_verification_required')

    // /api/auth/me stays reachable so the client can show resend UI, but it
    // reports no active school memberships before verification.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(me.status).toBe(200)
    expect(me.body.user.emailVerified).toBe(false)
    expect(me.body.memberships).toEqual([])

    // Verify, then the same session gains school access and the membership
    // becomes active.
    const link = email.lastMessage()?.text.match(/https?:\/\/\S*token=\S+/)?.[0]
    const verify = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromLink(link!.replace(/[.,]$/, '')) })
    expect(verify.status).toBe(200)
    await expect(auth.listActiveMemberships(user!.id)).resolves.toMatchObject([
      { schoolId, schoolStatus: 'active', role: 'school_admin' },
    ])

    const mineAfter = await request(app).get('/api/schools/mine').set('Cookie', cookie)
    expect(mineAfter.status).toBe(200)
    expect(mineAfter.body.memberships).toHaveLength(1)

    const oneAfter = await request(app)
      .get(`/api/schools/${schoolId}`)
      .set('Cookie', cookie)
    expect(oneAfter.status).toBe(200)
  })
})
