import { randomUUID } from 'node:crypto'
import { hashPassword } from '../../src/lib/passwords.ts'
import { hashSessionToken } from '../../src/lib/sessionTokens.ts'
import {
  generateVerificationToken,
  hashVerificationToken,
} from '../../src/lib/verificationTokens.ts'
import {
  DuplicateEmailError,
  DuplicateSchoolSlugError,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
} from '../../src/services/auth.ts'
import type {
  AuthService,
  AuthSession,
  MembershipSummary,
  MembershipWithSchool,
  RegisterSchoolInput,
  SchoolRecord,
  SchoolRole,
  UserStatus,
  UserWithPassword,
  VerificationOutcome,
} from '../../src/services/auth.ts'
import { SESSION_TTL_MS } from '../../src/services/auth.ts'

/**
 * In-memory AuthService implementing the same contracts as the Neon-backed
 * implementation, so HTTP-level auth tests exercise the real routes,
 * middleware, cookies, and password hashing without a database.
 * Seeded passwords are stored as real scrypt hashes.
 *
 * Seeds represent operator-provisioned accounts, so they default to
 * emailVerified: true (like accounts backfilled by migration 0002);
 * pass emailVerified: false to model a pending self-registration.
 */

type FakeSession = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
}

type FakeVerificationToken = {
  userId: string
  tokenHash: string
  expiresAt: Date
  consumedAt: Date | null
}

export type FakeMembership = {
  school: SchoolRecord
  role: SchoolRole
  status: 'pending' | 'active' | 'revoked'
}

export type FakeAuthService = AuthService & {
  seedUser(input: {
    email: string
    password: string
    displayName: string
    status?: UserStatus
    isPlatformAdmin?: boolean
    emailVerified?: boolean
  }): Promise<UserWithPassword>
  seedSchool(input?: {
    name?: string
    slug?: string
    status?: string
  }): SchoolRecord
  seedMembership(input: {
    userId: string
    school: SchoolRecord
    role: SchoolRole
    status?: 'pending' | 'active' | 'revoked'
  }): void
  sessionCount(): number
  userCount(): number
  schoolCount(): number
  membershipCount(): number
  /** Pending (unconsumed) verification tokens across all users. */
  liveVerificationTokenCount(): number
  /** Makes the next registerSchoolWithAdmin call fail before writing anything. */
  failNextRegistration(withError?: Error): void
  /** Forces every outstanding verification token into the past (expiry tests). */
  expireVerificationTokens(): void
}

export function createFakeAuthService(): FakeAuthService {
  const usersByEmail = new Map<string, UserWithPassword>()
  const sessionsByTokenHash = new Map<string, FakeSession>()
  const membershipsByUser = new Map<string, FakeMembership[]>()
  const schoolsById = new Map<string, SchoolRecord>()
  const verificationTokensByHash = new Map<string, FakeVerificationToken>()
  let registrationFailure: Error | null = null

  function toRecord(user: UserWithPassword) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerified: user.emailVerified,
    }
  }

  return {
    async seedUser(input) {
      const user: UserWithPassword = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        status: input.status ?? 'active',
        isPlatformAdmin: input.isPlatformAdmin ?? false,
        emailVerified: input.emailVerified ?? true,
        passwordHash: await hashPassword(input.password),
      }
      usersByEmail.set(user.email, user)
      return user
    },

    seedSchool(input = {}) {
      const school: SchoolRecord = {
        id: randomUUID(),
        name: input.name ?? 'Test School',
        slug: input.slug ?? `school-${randomUUID().slice(0, 8)}`,
        status: input.status ?? 'active',
      }
      schoolsById.set(school.id, school)
      return school
    },

    seedMembership(input) {
      const list = membershipsByUser.get(input.userId) ?? []
      list.push({
        school: input.school,
        role: input.role,
        status: input.status ?? 'active',
      })
      membershipsByUser.set(input.userId, list)
    },

    sessionCount() {
      return sessionsByTokenHash.size
    },

    userCount() {
      return usersByEmail.size
    },

    schoolCount() {
      return schoolsById.size
    },

    membershipCount() {
      let total = 0
      for (const list of membershipsByUser.values()) {
        total += list.length
      }
      return total
    },

    liveVerificationTokenCount() {
      let total = 0
      for (const token of verificationTokensByHash.values()) {
        if (token.consumedAt === null) {
          total += 1
        }
      }
      return total
    },

    failNextRegistration(withError) {
      registrationFailure = withError ?? new Error('simulated registration failure')
    },

    expireVerificationTokens() {
      const past = new Date(Date.now() - 1000)
      for (const token of verificationTokensByHash.values()) {
        if (token.consumedAt === null) {
          token.expiresAt = past
        }
      }
    },

    async findUserByEmail(email) {
      return usersByEmail.get(email) ?? null
    },

    async createSession(userId, options) {
      const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
      const session: FakeSession = {
        id: randomUUID(),
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        revokedAt: null,
        userAgent: options?.userAgent?.slice(0, 300) ?? null,
      }
      sessionsByTokenHash.set(session.tokenHash, session)
      return { token, expiresAt: session.expiresAt }
    },

    async getSessionUser(token) {
      const session = sessionsByTokenHash.get(hashSessionToken(token))
      if (!session || session.revokedAt !== null) {
        return null
      }
      if (session.expiresAt.getTime() <= Date.now()) {
        return null
      }
      const user = [...usersByEmail.values()].find((u) => u.id === session.userId)
      if (!user) {
        return null
      }
      const authSession: AuthSession = {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        user: toRecord(user),
      }
      return authSession
    },

    async revokeSession(token) {
      const session = sessionsByTokenHash.get(hashSessionToken(token))
      if (!session || session.revokedAt !== null) {
        return false
      }
      session.revokedAt = new Date()
      return true
    },

    async touchLastLogin() {
      // No-op for the fake; last_login_at persistence is covered by the
      // gated database integration tests.
    },

    async listActiveMemberships(userId): Promise<MembershipSummary[]> {
      return (membershipsByUser.get(userId) ?? [])
        .filter((m) => m.status === 'active')
        .map((m) => ({
          schoolId: m.school.id,
          schoolName: m.school.name,
          schoolSlug: m.school.slug,
          schoolStatus: m.school.status,
          role: m.role,
        }))
    },

    async findActiveMembership(
      userId,
      schoolId,
    ): Promise<MembershipWithSchool | null> {
      const membership = (membershipsByUser.get(userId) ?? []).find(
        (m) => m.school.id === schoolId && m.status === 'active',
      )
      return membership ? { school: membership.school, role: membership.role } : null
    },

    async findSchoolById(schoolId) {
      return schoolsById.get(schoolId) ?? null
    },

    async createPlatformAdmin(input) {
      const existing = usersByEmail.get(input.email)
      if (existing) {
        existing.isPlatformAdmin = true
        existing.displayName = input.displayName
        existing.emailVerified = true
        return { id: existing.id, created: false }
      }
      const user: UserWithPassword = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        status: 'active',
        isPlatformAdmin: true,
        emailVerified: true,
        passwordHash: input.passwordHash,
      }
      usersByEmail.set(user.email, user)
      return { id: user.id, created: true }
    },

    async registerSchoolWithAdmin(input: RegisterSchoolInput) {
      // Mirrors the DB transaction: validate conflicts BEFORE any write so
      // no orphan school / user / membership can exist after a failure.
      if (registrationFailure) {
        const failure = registrationFailure
        registrationFailure = null
        throw failure
      }
      if (usersByEmail.has(input.email)) {
        throw new DuplicateEmailError()
      }
      const slugTaken = [...schoolsById.values()].some(
        (school) => school.slug === input.schoolSlug,
      )
      if (slugTaken) {
        throw new DuplicateSchoolSlugError()
      }

      const school: SchoolRecord = {
        id: randomUUID(),
        name: input.schoolName,
        slug: input.schoolSlug,
        status: 'pending_verification',
      }
      const user: UserWithPassword = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        status: 'active',
        isPlatformAdmin: false, // public registration can never grant this
        emailVerified: false, // verification happens via token redemption
        passwordHash: input.passwordHash,
      }
      schoolsById.set(school.id, school)
      usersByEmail.set(user.email, user)
      membershipsByUser.set(user.id, [
        { school, role: 'school_admin', status: 'pending' },
      ])
      return { userId: user.id, schoolId: school.id }
    },

    async createEmailVerificationToken(userId, options) {
      const token = generateVerificationToken()
      const ttlMs = options?.ttlMs ?? EMAIL_VERIFICATION_TOKEN_TTL_MS
      // Supersede outstanding tokens: at most one live token per user.
      for (const [hash, existing] of verificationTokensByHash) {
        if (existing.userId === userId && existing.consumedAt === null) {
          verificationTokensByHash.delete(hash)
        }
      }
      const record: FakeVerificationToken = {
        userId,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
        consumedAt: null,
      }
      verificationTokensByHash.set(record.tokenHash, record)
      return { token, expiresAt: record.expiresAt }
    },

    async consumeEmailVerificationToken(token): Promise<VerificationOutcome> {
      const record = verificationTokensByHash.get(hashVerificationToken(token))
      if (!record) {
        return { status: 'invalid' }
      }
      if (record.consumedAt !== null) {
        return { status: 'used' }
      }
      if (record.expiresAt.getTime() <= Date.now()) {
        return { status: 'expired' }
      }
      record.consumedAt = new Date() // atomic single-use claim
      const user = [...usersByEmail.values()].find((u) => u.id === record.userId)
      if (!user) {
        return { status: 'invalid' }
      }
      user.emailVerified = true
      // Same lifecycle as the DB implementation: verification activates the
      // founding administrator's pending membership(s) only for schools that
      // are still awaiting verification. Revoked memberships and
      // suspended/archived schools are never reactivated.
      for (const membership of membershipsByUser.get(user.id) ?? []) {
        if (
          membership.status === 'pending' &&
          membership.school.status === 'pending_verification'
        ) {
          membership.status = 'active'
          membership.school.status = 'active'
          const storedSchool = schoolsById.get(membership.school.id)
          if (storedSchool) {
            storedSchool.status = 'active'
          }
        }
      }
      return { status: 'verified', user: toRecord(user) }
    },
  }
}
