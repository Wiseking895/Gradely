import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDbPool } from '../src/lib/db.ts'
import { hashPassword, verifyPassword } from '../src/lib/passwords.ts'
import {
  createDbAuthService,
  DuplicateEmailError,
  DuplicateSchoolSlugError,
} from '../src/services/auth.ts'
import type { Pool } from 'pg'

/**
 * Schema + service integration tests against a real PostgreSQL database.
 *
 * GATED: runs only when TEST_DATABASE_URL points to a **scratch** database
 * (never production Neon). The target schema is dropped and recreated, so
 * only ever point this at a disposable database.
 *
 *   TEST_DATABASE_URL=postgresql://... npm test
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!testDatabaseUrl)('auth schema + service (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = createDbPool(testDatabaseUrl!)
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
    // Apply the migrations in order so the schema matches what the
    // application actually expects (0002 adds users.email_verified_at and
    // email_verification_tokens; 0003 adds the school/membership activation
    // lifecycle and the one-live-token index).
    for (const file of [
      '0001_auth_foundation.sql',
      '0002_email_verification.sql',
      '0003_school_verification_lifecycle.sql',
    ]) {
      const sql = await readFile(
        fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)),
        'utf8',
      )
      await pool.query(sql)
    }
  }, 60_000)

  afterAll(async () => {
    if (pool) {
      await pool.end()
    }
  })

  it('rejects duplicate emails and enforces lowercase normalization', async () => {
    const hash = await hashPassword('password-one')
    await pool.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('dup@school.test', 'Dup', $1)`,
      [hash],
    )
    await expect(
      pool.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('dup@school.test', 'Other', $1)`,
        [hash],
      ),
    ).rejects.toThrow(/duplicate key/)
    await expect(
      pool.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('UPPER@school.test', 'Case', $1)`,
        [hash],
      ),
    ).rejects.toThrow(/check constraint/)
  })

  it('rejects plaintext-looking password hashes via the CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('plain@school.test', 'Plain', 'password123')`,
      ),
    ).rejects.toThrow(/check constraint/)
  })

  it('cascades membership and session deletion when a user is deleted', async () => {
    const hash = await hashPassword('cascade-password')
    const school = await pool.query(
      `INSERT INTO schools (name, slug) VALUES ('Cascade School', 'cascade-school') RETURNING id`,
    )
    const user = await pool.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('cascade@school.test', 'Cascade', $1) RETURNING id`,
      [hash],
    )
    const userId = user.rows[0].id as string
    const schoolId = school.rows[0].id as string
    await pool.query(
      `INSERT INTO school_memberships (school_id, user_id, role)
       VALUES ($1, $2, 'teacher')`,
      [schoolId, userId],
    )
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, repeat('a', 64), now() + interval '1 day')`,
      [userId],
    )

    await pool.query('DELETE FROM users WHERE id = $1', [userId])

    const memberships = await pool.query(
      'SELECT 1 FROM school_memberships WHERE user_id = $1',
      [userId],
    )
    const sessions = await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [userId])
    expect(memberships.rowCount).toBe(0)
    expect(sessions.rowCount).toBe(0)
  })

  it('runs the real AuthService end-to-end (login lookup, session, membership)', async () => {
    const auth = createDbAuthService(() => pool)
    const hash = await hashPassword('Integration-Pass1!')
    const school = await pool.query(
      `INSERT INTO schools (name, slug) VALUES ('Integration School', 'integration-school') RETURNING id`,
    )
    const schoolId = school.rows[0].id as string
    const created = await pool.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('integration@school.test', 'Integration', $1) RETURNING id`,
      [hash],
    )
    const userId = created.rows[0].id as string
    await pool.query(
      `INSERT INTO school_memberships (school_id, user_id, role)
       VALUES ($1, $2, 'school_admin')`,
      [schoolId, userId],
    )

    const user = await auth.findUserByEmail('integration@school.test')
    expect(user).not.toBeNull()
    await expect(
      verifyPassword('Integration-Pass1!', user!.passwordHash),
    ).resolves.toBe(true)

    const { token } = await auth.createSession(userId, { userAgent: 'vitest' })
    const session = await auth.getSessionUser(token)
    expect(session?.user.email).toBe('integration@school.test')

    const membership = await auth.findActiveMembership(userId, schoolId)
    expect(membership?.role).toBe('school_admin')

    await expect(auth.revokeSession(token)).resolves.toBe(true)
    await expect(auth.getSessionUser(token)).resolves.toBeNull()
    await expect(auth.revokeSession(token)).resolves.toBe(false)
  }, 30_000)

  it('registers school+admin transactionally, blocks platform-admin grant, and verifies via single-use token', async () => {
    const auth = createDbAuthService(() => pool)
    const passwordHash = await hashPassword('Integration-Pass1!')

    const created = await auth.registerSchoolWithAdmin({
      schoolName: 'Registered School',
      schoolSlug: 'registered-school',
      email: 'owner@registered.test',
      displayName: 'Olivia Owner',
      passwordHash,
    })
    expect(created.userId).toBeTruthy()
    expect(created.schoolId).toBeTruthy()

    // Real rows exist and are consistent: the school and the founding
    // membership stay pending until the owner's email is verified. The user
    // is unverified and never a platform administrator.
    const school = await pool.query(
      'SELECT id, status FROM schools WHERE id = $1',
      [created.schoolId],
    )
    expect(school.rows[0].status).toBe('pending_verification')

    const user = await auth.findUserByEmail('owner@registered.test')
    expect(user?.isPlatformAdmin).toBe(false)
    expect(user?.emailVerified).toBe(false)

    // Pending membership is not "active": it grants no school access yet.
    await expect(
      auth.findActiveMembership(created.userId, created.schoolId),
    ).resolves.toBeNull()
    await expect(auth.listActiveMemberships(created.userId)).resolves.toEqual([])
    const pendingMembership = await pool.query(
      'SELECT status FROM school_memberships WHERE user_id = $1 AND school_id = $2',
      [created.userId, created.schoolId],
    )
    expect(pendingMembership.rows[0].status).toBe('pending')

    // Duplicate email rolls the whole transaction back: no orphan school row
    // is left behind for the fresh slug used in the failed attempt.
    await expect(
      auth.registerSchoolWithAdmin({
        schoolName: 'Orphan School',
        schoolSlug: 'orphan-check',
        email: 'owner@registered.test',
        displayName: 'Dup Email',
        passwordHash,
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError)
    const orphan = await pool.query('SELECT 1 FROM schools WHERE slug = $1', [
      'orphan-check',
    ])
    expect(orphan.rowCount).toBe(0)

    // Duplicate slug (different email) likewise maps to its own error type.
    await expect(
      auth.registerSchoolWithAdmin({
        schoolName: 'Dup Slug School',
        schoolSlug: 'registered-school',
        email: 'other@registered.test',
        displayName: 'Other Owner',
        passwordHash,
      }),
    ).rejects.toBeInstanceOf(DuplicateSchoolSlugError)

    // Verification lifecycle: the token marks the user verified once and
    // activates both the founding membership and the pending school. A
    // replay of the same raw token reports 'used'.
    const { token } = await auth.createEmailVerificationToken(created.userId)
    const first = await auth.consumeEmailVerificationToken(token)
    expect(first.status).toBe('verified')
    const replay = await auth.consumeEmailVerificationToken(token)
    expect(replay.status).toBe('used')
    const afterVerify = await auth.findUserByEmail('owner@registered.test')
    expect(afterVerify?.emailVerified).toBe(true)

    const schoolAfter = await pool.query('SELECT status FROM schools WHERE id = $1', [
      created.schoolId,
    ])
    expect(schoolAfter.rows[0].status).toBe('active')
    const membershipAfter = await auth.findActiveMembership(
      created.userId,
      created.schoolId,
    )
    expect(membershipAfter?.role).toBe('school_admin')
    await expect(auth.listActiveMemberships(created.userId)).resolves.toMatchObject([
      { schoolId: created.schoolId, schoolStatus: 'active' },
    ])

    // Resend supersedes: a second live token invalidates the first, which
    // can no longer be redeemed.
    const second = await auth.registerSchoolWithAdmin({
      schoolName: 'Token Supersede School',
      schoolSlug: 'token-supersede',
      email: 'supersede@registered.test',
      displayName: 'Sam Supersede',
      passwordHash,
    })
    const stale = await auth.createEmailVerificationToken(second.userId)
    const fresh = await auth.createEmailVerificationToken(second.userId)
    await expect(
      auth.consumeEmailVerificationToken(stale.token),
    ).resolves.toMatchObject({ status: 'invalid' })
    await expect(
      auth.consumeEmailVerificationToken(fresh.token),
    ).resolves.toMatchObject({ status: 'verified' })
  }, 60_000)

  it('keeps at most one live token when resends race', async () => {
    const auth = createDbAuthService(() => pool)
    const passwordHash = await hashPassword('Integration-Pass3!')
    const created = await auth.registerSchoolWithAdmin({
      schoolName: 'Race School',
      schoolSlug: 'race-school',
      email: 'race@registered.test',
      displayName: 'Rae Race',
      passwordHash,
    })

    const attempts = await Promise.all([
      auth.createEmailVerificationToken(created.userId),
      auth.createEmailVerificationToken(created.userId),
    ])

    const live = await pool.query(
      `SELECT count(*)::int AS live
       FROM email_verification_tokens
       WHERE user_id = $1 AND consumed_at IS NULL`,
      [created.userId],
    )
    expect(live.rows[0].live).toBe(1)

    const outcomes = []
    for (const attempt of attempts) {
      outcomes.push(await auth.consumeEmailVerificationToken(attempt.token))
    }
    expect(outcomes.filter((outcome) => outcome.status === 'verified')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'invalid')).toHaveLength(1)
    const user = await auth.findUserByEmail('race@registered.test')
    expect(user?.emailVerified).toBe(true)
  }, 30_000)

  it('never reactivates a suspended school or grants its pending membership', async () => {
    const auth = createDbAuthService(() => pool)
    const passwordHash = await hashPassword('Integration-Pass4!')
    const created = await auth.registerSchoolWithAdmin({
      schoolName: 'Suspended School',
      schoolSlug: 'suspended-school',
      email: 'suspended@registered.test',
      displayName: 'Sam Suspended',
      passwordHash,
    })
    await pool.query(`UPDATE schools SET status = 'suspended' WHERE id = $1`, [
      created.schoolId,
    ])

    const { token } = await auth.createEmailVerificationToken(created.userId)
    await expect(
      auth.consumeEmailVerificationToken(token),
    ).resolves.toMatchObject({ status: 'verified' })

    const school = await pool.query('SELECT status FROM schools WHERE id = $1', [
      created.schoolId,
    ])
    expect(school.rows[0].status).toBe('suspended')
    const membership = await pool.query(
      'SELECT status FROM school_memberships WHERE user_id = $1 AND school_id = $2',
      [created.userId, created.schoolId],
    )
    expect(membership.rows[0].status).toBe('pending')
    await expect(
      auth.findActiveMembership(created.userId, created.schoolId),
    ).resolves.toBeNull()
  }, 30_000)

  it('reports expired verification tokens as expired (real clock)', async () => {
    const auth = createDbAuthService(() => pool)
    const passwordHash = await hashPassword('Integration-Pass2!')
    const created = await auth.registerSchoolWithAdmin({
      schoolName: 'Expiry School',
      schoolSlug: 'expiry-school',
      email: 'expiry@registered.test',
      displayName: 'Eve Expiry',
      passwordHash,
    })
    // A short-but-safe TTL clear of database/network clock skew so the
    // expires_at > created_at CHECK is reliable, then the row ages out
    // before redemption.
    const { token } = await auth.createEmailVerificationToken(created.userId, {
      ttlMs: 1000,
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await expect(
      auth.consumeEmailVerificationToken(token),
    ).resolves.toMatchObject({ status: 'expired' })
    const user = await auth.findUserByEmail('expiry@registered.test')
    expect(user?.emailVerified).toBe(false)
  }, 30_000)
})
