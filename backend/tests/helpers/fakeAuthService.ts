import { randomUUID } from 'node:crypto'
import { hashPassword } from '../../src/lib/passwords.ts'
import { hashSessionToken } from '../../src/lib/sessionTokens.ts'
import type {
  AuthService,
  AuthSession,
  MembershipSummary,
  MembershipWithSchool,
  SchoolRecord,
  SchoolRole,
  UserStatus,
  UserWithPassword,
} from '../../src/services/auth.ts'
import { SESSION_TTL_MS } from '../../src/services/auth.ts'

/**
 * In-memory AuthService implementing the same contracts as the Neon-backed
 * implementation, so HTTP-level auth tests exercise the real routes,
 * middleware, cookies, and password hashing without a database.
 * Seeded passwords are stored as real scrypt hashes.
 */

type FakeSession = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
}

export type FakeMembership = {
  school: SchoolRecord
  role: SchoolRole
  status: 'active' | 'revoked'
}

export type FakeAuthService = AuthService & {
  seedUser(input: {
    email: string
    password: string
    displayName: string
    status?: UserStatus
    isPlatformAdmin?: boolean
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
    status?: 'active' | 'revoked'
  }): void
  sessionCount(): number
}

export function createFakeAuthService(): FakeAuthService {
  const usersByEmail = new Map<string, UserWithPassword>()
  const sessionsByTokenHash = new Map<string, FakeSession>()
  const membershipsByUser = new Map<string, FakeMembership[]>()
  const schoolsById = new Map<string, SchoolRecord>()

  return {
    async seedUser(input) {
      const user: UserWithPassword = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        status: input.status ?? 'active',
        isPlatformAdmin: input.isPlatformAdmin ?? false,
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
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          status: user.status,
          isPlatformAdmin: user.isPlatformAdmin,
        },
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
        return { id: existing.id, created: false }
      }
      const user: UserWithPassword = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        status: 'active',
        isPlatformAdmin: true,
        passwordHash: input.passwordHash,
      }
      usersByEmail.set(user.email, user)
      return { id: user.id, created: true }
    },
  }
}
