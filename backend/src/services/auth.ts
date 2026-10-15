import type { Pool } from 'pg'
import { generateSessionToken, hashSessionToken } from '../lib/sessionTokens.ts'

/**
 * Authentication data-access layer.
 *
 * - Routes and middleware depend on the AuthService *interface* only, so
 *   HTTP tests can inject an in-memory implementation (tests/auth.test.ts)
 *   while production uses createDbAuthService() backed by Neon via pg.
 * - The pool is passed as a lazy accessor so creating the app never opens a
 *   database connection (health endpoints keep working without DATABASE_URL).
 */

export type UserStatus = 'active' | 'disabled'
export type SchoolRole = 'school_admin' | 'teacher'
export type MembershipStatus = 'active' | 'revoked'

export type UserRecord = {
  id: string
  email: string
  displayName: string
  status: UserStatus
  isPlatformAdmin: boolean
}

export type UserWithPassword = UserRecord & { passwordHash: string }

export type AuthSession = {
  sessionId: string
  expiresAt: Date
  user: UserRecord
}

export type SchoolRecord = {
  id: string
  name: string
  slug: string
  status: string
}

export type MembershipSummary = {
  schoolId: string
  schoolName: string
  schoolSlug: string
  schoolStatus: string
  role: SchoolRole
}

export type MembershipWithSchool = {
  school: SchoolRecord
  role: SchoolRole
}

export interface AuthService {
  findUserByEmail(email: string): Promise<UserWithPassword | null>
  createSession(
    userId: string,
    options?: { userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date }>
  getSessionUser(token: string): Promise<AuthSession | null>
  revokeSession(token: string): Promise<boolean>
  touchLastLogin(userId: string): Promise<void>
  listActiveMemberships(userId: string): Promise<MembershipSummary[]>
  findActiveMembership(
    userId: string,
    schoolId: string,
  ): Promise<MembershipWithSchool | null>
  findSchoolById(schoolId: string): Promise<SchoolRecord | null>
  createPlatformAdmin(input: {
    email: string
    displayName: string
    passwordHash: string
  }): Promise<{ id: string; created: boolean }>
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type UserRow = {
  id: string
  email: string
  display_name: string
  status: string
  is_platform_admin: boolean
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    isPlatformAdmin: row.is_platform_admin === true,
  }
}

export function createDbAuthService(getPool: () => Pool): AuthService {
  return {
    async findUserByEmail(email) {
      const result = await getPool().query(
        `SELECT id, email, display_name, status, is_platform_admin, password_hash
         FROM users
         WHERE email = $1`,
        [email],
      )
      const row = result.rows[0] as
        | (UserRow & { password_hash: string })
        | undefined
      if (!row) {
        return null
      }
      return { ...toUserRecord(row), passwordHash: row.password_hash }
    },

    async createSession(userId, options) {
      const token = generateSessionToken()
      const tokenHash = hashSessionToken(token)
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      const userAgent = options?.userAgent?.slice(0, 300) ?? null

      const result = await getPool().query(
        `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING expires_at`,
        [userId, tokenHash, userAgent, expiresAt],
      )

      return { token, expiresAt: result.rows[0].expires_at as Date }
    },

    async getSessionUser(token) {
      const tokenHash = hashSessionToken(token)
      const result = await getPool().query(
        `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
                u.id, u.email, u.display_name, u.status, u.is_platform_admin
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1`,
        [tokenHash],
      )
      const row = result.rows[0] as
        | {
            session_id: string
            expires_at: Date
            revoked_at: Date | null
          } & UserRow
        | undefined
      if (!row || row.revoked_at !== null) {
        return null
      }
      const expiresAt = new Date(row.expires_at)
      if (expiresAt.getTime() <= Date.now()) {
        return null
      }
      return {
        sessionId: row.session_id,
        expiresAt,
        user: toUserRecord(row),
      }
    },

    async revokeSession(token) {
      const tokenHash = hashSessionToken(token)
      const result = await getPool().query(
        `UPDATE sessions
         SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      )
      return (result.rowCount ?? 0) > 0
    },

    async touchLastLogin(userId) {
      await getPool().query(
        `UPDATE users SET last_login_at = now() WHERE id = $1`,
        [userId],
      )
    },

    async listActiveMemberships(userId) {
      const result = await getPool().query(
        `SELECT m.school_id, m.role,
                s.name AS school_name, s.slug AS school_slug, s.status AS school_status
         FROM school_memberships m
         JOIN schools s ON s.id = m.school_id
         WHERE m.user_id = $1 AND m.status = 'active'
         ORDER BY s.name ASC`,
        [userId],
      )
      return result.rows.map((row: {
        school_id: string
        role: string
        school_name: string
        school_slug: string
        school_status: string
      }) => ({
        schoolId: row.school_id,
        schoolName: row.school_name,
        schoolSlug: row.school_slug,
        schoolStatus: row.school_status,
        role: row.role === 'teacher' ? 'teacher' : 'school_admin',
      }))
    },

    async findActiveMembership(userId, schoolId) {
      const result = await getPool().query(
        `SELECT m.role,
                s.id, s.name, s.slug, s.status
         FROM school_memberships m
         JOIN schools s ON s.id = m.school_id
         WHERE m.user_id = $1 AND m.school_id = $2 AND m.status = 'active'`,
        [userId, schoolId],
      )
      const row = result.rows[0] as
        | { role: string; id: string; name: string; slug: string; status: string }
        | undefined
      if (!row) {
        return null
      }
      return {
        role: row.role === 'teacher' ? ('teacher' as const) : ('school_admin' as const),
        school: { id: row.id, name: row.name, slug: row.slug, status: row.status },
      }
    },

    async findSchoolById(schoolId) {
      const result = await getPool().query(
        `SELECT id, name, slug, status FROM schools WHERE id = $1`,
        [schoolId],
      )
      const row = result.rows[0] as
        | { id: string; name: string; slug: string; status: string }
        | undefined
      return row ? { id: row.id, name: row.name, slug: row.slug, status: row.status } : null
    },

    async createPlatformAdmin(input) {
      const result = await getPool().query(
        `INSERT INTO users (email, display_name, password_hash, is_platform_admin)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE
           SET is_platform_admin = true,
               display_name = EXCLUDED.display_name
         RETURNING id, (xmax = 0) AS created`,
        [input.email, input.displayName, input.passwordHash],
      )
      const row = result.rows[0] as { id: string; created: boolean }
      return { id: row.id, created: row.created === true }
    },
  }
}
