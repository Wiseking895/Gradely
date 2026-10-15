import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDbPool } from '../src/lib/db.ts'
import { hashPassword, verifyPassword } from '../src/lib/passwords.ts'
import { createDbAuthService } from '../src/services/auth.ts'
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
    const sql = await readFile(
      fileURLToPath(new URL('../migrations/0001_auth_foundation.sql', import.meta.url)),
      'utf8',
    )
    await pool.query(sql)
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
})
