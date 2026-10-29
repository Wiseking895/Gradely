import '../config/loadEnv.ts'
import { env } from '../config/env.ts'
import { createDbPool } from '../lib/db.ts'
import { hashPassword } from '../lib/passwords.ts'
import {
  assertConnectedDatabaseTarget,
  assertConnectedScratchTarget,
  assertScratchDatabaseUrl,
  describeDatabaseTarget,
  isLoopbackDatabaseUrl,
  parseDatabaseTarget,
  type DatabaseTarget,
} from '../lib/scratchDatabase.ts'
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
 * - Uses the same guarded connection routing as migrations: scratch mode uses
 *   SCRATCH_DATABASE_URL only; normal mode uses MIGRATION_DATABASE_URL, then
 *   DIRECT_URL, then DATABASE_URL. Any non-loopback target requires the
 *   explicit --allow-remote confirmation flag. Never run this against
 *   production without approval.
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

  const scratch =
    process.argv.includes('--scratch') || env.GRADELY_ENV === 'scratch'
  const allowRemote = process.argv.includes('--allow-remote')

  if (scratch && !env.SCRATCH_DATABASE_URL) {
    throw new Error(
      'Scratch admin creation requires SCRATCH_DATABASE_URL in the selected scratch environment file.',
    )
  }

  const connectionString = scratch
    ? env.SCRATCH_DATABASE_URL
    : (env.MIGRATION_DATABASE_URL ?? env.DIRECT_URL ?? env.DATABASE_URL)

  if (!connectionString) {
    throw new Error('No connection string. Set DATABASE_URL or DIRECT_URL.')
  }

  const target: DatabaseTarget = scratch
    ? assertScratchDatabaseUrl(connectionString, {
        mode: 'scratch',
        nodeEnv: env.NODE_ENV,
        env: process.env,
      })
    : parseDatabaseTarget(connectionString)

  if (!scratch) {
    const description = describeDatabaseTarget(target)

    if (!isLoopbackDatabaseUrl(connectionString) && !allowRemote) {
      throw new Error(
        `Refusing admin creation against non-loopback target ${description} without --allow-remote`,
      )
    }

    if (env.isProduction && !allowRemote) {
      throw new Error(
        `Refusing admin creation with NODE_ENV=production without --allow-remote (target ${description})`,
      )
    }
  }

  console.log(`Requested target: ${describeDatabaseTarget(target)}`)

  const pool = createDbPool(connectionString)
  try {
    if (scratch) {
      await assertConnectedScratchTarget(pool, target)
    } else {
      await assertConnectedDatabaseTarget(pool, target)
    }

    console.log('Connected target verified.')

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
