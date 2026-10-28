import type { Pool, PoolClient } from 'pg'
import { generateSessionToken, hashSessionToken } from '../lib/sessionTokens.ts'
import {
  generateVerificationToken,
  hashVerificationToken,
} from '../lib/verificationTokens.ts'

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
  /** users.email_verified_at IS NOT NULL — see migration 0002. */
  emailVerified: boolean
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

/** Input for the transactional school + administrator registration. */
export type RegisterSchoolInput = {
  schoolName: string
  schoolSlug: string
  email: string
  displayName: string
  passwordHash: string
}

/** Result of redeeming an email-verification token (single use). */
export type VerificationOutcome =
  | { status: 'verified'; user: UserRecord }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'used' }

/** Registration conflicts raised by the data layer (mapped to HTTP 409). */
export class DuplicateEmailError extends Error {
  constructor() {
    super('email already registered')
    this.name = 'DuplicateEmailError'
  }
}

export class DuplicateSchoolSlugError extends Error {
  constructor() {
    super('school identifier already in use')
    this.name = 'DuplicateSchoolSlugError'
  }
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
  /**
   * Creates school + administrator user + school_admin membership in ONE
   * transaction. Throws DuplicateEmailError / DuplicateSchoolSlugError on
   * conflicts; on any failure nothing is persisted (no orphan schools or
   * half-registered accounts). The created user is always unverified and
   * never a platform administrator; the school starts 'pending_verification'
   * and the founding membership starts 'pending' until email verification.
   */
  registerSchoolWithAdmin(
    input: RegisterSchoolInput,
  ): Promise<{ userId: string; schoolId: string }>
  /**
   * Issues a fresh single-use verification token, superseding any
   * outstanding (unconsumed) token for that user. Only the hash is stored.
   */
  createEmailVerificationToken(
    userId: string,
    options?: { ttlMs?: number },
  ): Promise<{ token: string; expiresAt: Date }>
  /**
   * Atomically consumes a verification token and marks the user verified.
   * Single use: a second redemption of the same token reports 'used'.
   */
  consumeEmailVerificationToken(token: string): Promise<VerificationOutcome>
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type UserRow = {
  id: string
  email: string
  display_name: string
  status: string
  is_platform_admin: boolean
  email_verified_at: Date | null
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    isPlatformAdmin: row.is_platform_admin === true,
    emailVerified: row.email_verified_at !== null && row.email_verified_at !== undefined,
  }
}

const USER_COLUMNS = 'id, email, display_name, status, is_platform_admin, email_verified_at'

type PgConstraintError = Error & { code?: string; constraint?: string }

function isUniqueViolation(error: unknown): error is PgConstraintError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as PgConstraintError).code === '23505'
  )
}

/** Rolls back without masking the original error if the connection is already dead. */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Transaction already aborted at connection level; original error wins.
  }
}

export function createDbAuthService(getPool: () => Pool): AuthService {
  return {
    async findUserByEmail(email) {
      const result = await getPool().query(
        `SELECT ${USER_COLUMNS}, password_hash
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
                u.id, u.email, u.display_name, u.status, u.is_platform_admin,
                u.email_verified_at
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
        `INSERT INTO users (email, display_name, password_hash, is_platform_admin, email_verified_at)
         VALUES ($1, $2, $3, true, now())
         ON CONFLICT (email) DO UPDATE
           SET is_platform_admin = true,
               display_name = EXCLUDED.display_name,
               email_verified_at = COALESCE(users.email_verified_at, now())
         RETURNING id, (xmax = 0) AS created`,
        [input.email, input.displayName, input.passwordHash],
      )
      const row = result.rows[0] as { id: string; created: boolean }
      return { id: row.id, created: row.created === true }
    },

    async registerSchoolWithAdmin(input) {
      const client = await getPool().connect()
      try {
        await client.query('BEGIN')
        const school = await client.query(
          `INSERT INTO schools (name, slug, status)
           VALUES ($1, $2, 'pending_verification')
           RETURNING id`,
          [input.schoolName, input.schoolSlug],
        )
        const user = await client.query(
          `INSERT INTO users (email, display_name, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [input.email, input.displayName, input.passwordHash],
        )
        await client.query(
          `INSERT INTO school_memberships (school_id, user_id, role, status)
           VALUES ($1, $2, 'school_admin', 'pending')`,
          [school.rows[0].id as string, user.rows[0].id as string],
        )
        await client.query('COMMIT')
        return {
          userId: user.rows[0].id as string,
          schoolId: school.rows[0].id as string,
        }
      } catch (error) {
        await rollbackQuietly(client)
        if (isUniqueViolation(error)) {
          const constraint = (error as PgConstraintError).constraint ?? ''
          if (constraint.includes('email')) {
            throw new DuplicateEmailError()
          }
          if (constraint.includes('slug')) {
            throw new DuplicateSchoolSlugError()
          }
          // Constraint-name fallback: identify which record already exists.
          const emailExists = await getPool().query(
            'SELECT 1 FROM users WHERE email = $1',
            [input.email],
          )
          if ((emailExists.rowCount ?? 0) > 0) {
            throw new DuplicateEmailError()
          }
          const slugExists = await getPool().query(
            'SELECT 1 FROM schools WHERE slug = $1',
            [input.schoolSlug],
          )
          if ((slugExists.rowCount ?? 0) > 0) {
            throw new DuplicateSchoolSlugError()
          }
        }
        throw error
      } finally {
        client.release()
      }
    },

    async createEmailVerificationToken(userId, options) {
      const token = generateVerificationToken()
      const tokenHash = hashVerificationToken(token)
      const ttlMs = options?.ttlMs ?? EMAIL_VERIFICATION_TOKEN_TTL_MS
      const expiresAt = new Date(Date.now() + ttlMs)

      const client = await getPool().connect()
      try {
        await client.query('BEGIN')
        // Serialize concurrent resends for the same user. The partial unique
        // index in migration 0003 is the second line of defence.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId])
        // Supersede any outstanding token: at most one live token per user.
        await client.query(
          'DELETE FROM email_verification_tokens WHERE user_id = $1 AND consumed_at IS NULL',
          [userId],
        )
        await client.query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [userId, tokenHash, expiresAt],
        )
        await client.query('COMMIT')
        return { token, expiresAt }
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async consumeEmailVerificationToken(token) {
      const tokenHash = hashVerificationToken(token)
      const client = await getPool().connect()
      try {
        await client.query('BEGIN')
        const found = await client.query(
          `SELECT id, user_id, consumed_at, expires_at
           FROM email_verification_tokens
           WHERE token_hash = $1`,
          [tokenHash],
        )
        const row = found.rows[0] as
          | { id: string; user_id: string; consumed_at: Date | null; expires_at: Date }
          | undefined
        if (!row) {
          await client.query('COMMIT')
          return { status: 'invalid' as const }
        }
        if (row.consumed_at !== null) {
          await client.query('COMMIT')
          return { status: 'used' as const }
        }
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await client.query('COMMIT')
          return { status: 'expired' as const }
        }
        // Atomic single-use claim: only one concurrent caller wins.
        const claimed = await client.query(
          `UPDATE email_verification_tokens
           SET consumed_at = now()
           WHERE id = $1 AND consumed_at IS NULL`,
          [row.id],
        )
        if ((claimed.rowCount ?? 0) === 0) {
          await client.query('COMMIT')
          return { status: 'used' as const }
        }
        const updated = await client.query(
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $1
           RETURNING ${USER_COLUMNS}`,
          [row.user_id],
        )
        const userRow = updated.rows[0] as UserRow | undefined
        if (!userRow) {
          // User vanished (deleted concurrently): token is meaningless.
          await client.query('COMMIT')
          return { status: 'invalid' as const }
        }
        // Approved Phase A lifecycle: verification activates only the
        // founding administrator's pending membership(s) in schools that are
        // themselves still awaiting verification. Suspended/archived schools
        // are never reactivated, and their pending memberships stay pending
        // (so verification cannot grant access to a suspended school).
        await client.query(
          `UPDATE school_memberships m
           SET status = 'active'
           FROM schools s
           WHERE m.user_id = $1
             AND m.role = 'school_admin'
             AND m.status = 'pending'
             AND s.id = m.school_id
             AND s.status = 'pending_verification'`,
          [row.user_id],
        )
        await client.query(
          `UPDATE schools
           SET status = 'active'
           WHERE status = 'pending_verification'
             AND id IN (
               SELECT school_id FROM school_memberships
               WHERE user_id = $1
                 AND role = 'school_admin'
                 AND status = 'active'
             )`,
          [row.user_id],
        )
        // A successful verification invalidates every other outstanding link
        // for this account, including any legacy duplicate rows.
        await client.query(
          `UPDATE email_verification_tokens
           SET consumed_at = now()
           WHERE user_id = $1 AND consumed_at IS NULL`,
          [row.user_id],
        )
        await client.query('COMMIT')
        return { status: 'verified' as const, user: toUserRecord(userRow) }
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },
  }
}
