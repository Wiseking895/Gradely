import 'dotenv/config'
import { env } from '../config/env.ts'
import { createDbPool } from '../lib/db.ts'
import { hashPassword } from '../lib/passwords.ts'
import { createDbAuthService } from '../services/auth.ts'

/**
 * Controlled bootstrap of the first platform administrator.
 *
 * There is deliberately no public self-service registration. The platform
 * administrator is created manually by an operator with database access:
 *
 *   BOOTSTRAP_ADMIN_PASSWORD='...' \
 *     npm run admin:create -- --email admin@gradely.app --name "Admin Name"
 *
 * - The password is read from the BOOTSTRAP_ADMIN_PASSWORD environment
 *   variable (never from command-line arguments, which would be visible in
 *   process listings) and stored only as a scrypt hash.
 * - Idempotent: if the email already exists, the account is granted
 *   is_platform_admin and its display name is updated; the existing password
 *   is left untouched.
 * - Uses the same connection routing as migrations: DIRECT_URL, then
 *   DATABASE_URL. Never run this against production without approval.
 */

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length).trim()
}

async function main(): Promise<void> {
  const email = readArg('email')?.toLowerCase()
  const displayName = readArg('name')
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD

  if (!email || !displayName || !password) {
    throw new Error(
      'Usage: BOOTSTRAP_ADMIN_PASSWORD=... npm run admin:create -- --email <email> --name "<display name>"',
    )
  }

  const connectionString = env.DIRECT_URL ?? env.DATABASE_URL
  if (!connectionString) {
    throw new Error('No connection string. Set DATABASE_URL or DIRECT_URL.')
  }

  const pool = createDbPool(connectionString)
  try {
    const auth = createDbAuthService(() => pool)
    const passwordHash = await hashPassword(password)
    const { id, created } = await auth.createPlatformAdmin({
      email,
      displayName,
      passwordHash,
    })
    console.log(
      `${created ? 'Created' : 'Updated'} platform administrator ${email} (id ${id}).`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
