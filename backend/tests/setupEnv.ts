/**
 * Test environment isolation.
 *
 * This file is registered in vitest.config.ts and runs before test modules are
 * imported. It deliberately imports no application modules, so `src/config/env.ts`
 * cannot parse ambient production values first.
 *
 * TEST_DATABASE_URL is intentionally preserved: database integration tests
 * validate it themselves and fail closed when it is missing or unsafe.
 */

const AMBIENT_VARIABLES = [
  'DATABASE_URL',
  'DIRECT_URL',
  'MIGRATION_DATABASE_URL',
  'SCRATCH_DATABASE_URL',
  'GRADELY_ENV',
  'GRADELY_ENV_FILE',
  'DOTENV_CONFIG_PATH',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_APP_PASSWORD',
  'EMAIL_FROM_NAME',
  'EMAIL_FROM_ADDRESS',
  'APP_BASE_URL',
] as const

for (const name of AMBIENT_VARIABLES) {
  delete process.env[name]
}

process.env.NODE_ENV = 'test'
process.env.EMAIL_TRANSPORT = 'memory'
