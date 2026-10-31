import { z } from 'zod'
import { assertScratchDatabaseUrl } from '../lib/scratchDatabase.ts'
import { normalizeAppBaseUrl } from './email.ts'

/** Treats missing or blank values as unset; everything else must be non-empty. */
const optionalEnvString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
)

/**
 * Strict boolean parsing for environment strings. `Boolean('false')` is true,
 * so a typo here would silently enable the wrong mode; reject anything that is
 * not exactly true/false instead.
 */
const optionalStrictBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === '') {
    return undefined
  }
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return value
}, z.boolean().optional())

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // Local execution mode. `scratch` requires explicitly selected scratch-only
  // environment values; it never changes production behavior unless set.
  GRADELY_ENV: z
    .enum(['development', 'test', 'scratch', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Database (Neon PostgreSQL via the pg driver).
  // DATABASE_URL: Neon pooled connection string ("-pooler" host) used by the
  // application pool at runtime (src/lib/db.ts).
  DATABASE_URL: optionalEnvString,
  // DIRECT_URL: Neon direct (non-pooler) endpoint, used only by migrations
  // (npm run db:migrate) — Neon's recommended connection for schema changes.
  // Falls back to DATABASE_URL when unset.
  DIRECT_URL: optionalEnvString,

  // Scratch-only local targets. These must never contain production values.
  // Scratch execution selects SCRATCH_DATABASE_URL explicitly; migrations may
  // use MIGRATION_DATABASE_URL when a caller wants a separate target variable.
  SCRATCH_DATABASE_URL: optionalEnvString,
  MIGRATION_DATABASE_URL: optionalEnvString,

  // Email transport for the verification flow (src/services/email.ts).
  // Unset resolves to: production -> 'unavailable' (fail loudly until SMTP is
  // explicitly configured), test -> 'memory', development -> 'log'.
  // Selecting 'smtp' requires the SMTP_* variables below plus APP_BASE_URL.
  EMAIL_TRANSPORT: z
    .enum(['log', 'memory', 'unavailable', 'smtp'])
    .optional(),

  // SMTP connection settings (provider-neutral). Validated and consumed by
  // src/config/email.ts; smtp.gmail.com:465 with implicit TLS is the initial
  // planned production configuration. SMTP_APP_PASSWORD is intentionally NOT
  // listed here: it is read directly from process.env at transport
  // construction so the secret never lands on the exported `env` object.
  SMTP_HOST: optionalEnvString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: optionalStrictBoolean,
  SMTP_USER: optionalEnvString,
  EMAIL_FROM_NAME: optionalEnvString,
  EMAIL_FROM_ADDRESS: optionalEnvString,

  // Public origin of the frontend, used to build links inside emails.
  // Must be an absolute http(s) origin; https is required in production.
  APP_BASE_URL: optionalEnvString,

  // Cloudflare R2 (S3-compatible object storage). Optional at startup; only
  // required when storage features are used. Never sent to the frontend.
  R2_ACCOUNT_ID: optionalEnvString,
  R2_ACCESS_KEY_ID: optionalEnvString,
  R2_SECRET_ACCESS_KEY: optionalEnvString,
  R2_BUCKET_NAME: optionalEnvString,
  R2_PUBLIC_BASE_URL: optionalEnvString,
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

// In explicit scratch mode every configured database URL must be a safe local
// scratch target. This prevents a partially overridden shell from mixing
// production Neon values into a scratch run. Test-only environments may contain
// just TEST_DATABASE_URL, so presence is not required here.
if (parsed.data.GRADELY_ENV === 'scratch') {
  const candidates: Array<[string, string | undefined]> = [
    ['DATABASE_URL', parsed.data.DATABASE_URL],
    ['DIRECT_URL', parsed.data.DIRECT_URL],
    ['SCRATCH_DATABASE_URL', parsed.data.SCRATCH_DATABASE_URL],
    ['MIGRATION_DATABASE_URL', parsed.data.MIGRATION_DATABASE_URL],
  ]

  for (const [name, value] of candidates) {
    if (!value) {
      continue
    }

    try {
      assertScratchDatabaseUrl(value, {
        mode: 'scratch',
        nodeEnv: parsed.data.NODE_ENV,
        env: process.env,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid ${name} in scratch mode: ${message}`, {
        cause: error,
      })
    }
  }
}

const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Captured so the narrowing from the safeParse guard survives inside closures.
const data = parsed.data

/**
 * Frontend origin used for links inside emails.
 *
 * An explicit APP_BASE_URL wins; otherwise fall back to the first CORS origin
 * so behaviour is unchanged until routes migrate to `env.appBaseUrl`. The
 * fallback is validated as an absolute URL but does not require https, because
 * local development sets NODE_ENV=production in .env while still serving the
 * frontend over http://localhost:5173.
 */
function resolveAppBaseUrl(): string {
  if (data.APP_BASE_URL) {
    try {
      return normalizeAppBaseUrl(data.APP_BASE_URL, {
        requireHttps: data.NODE_ENV === 'production',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid APP_BASE_URL: ${message}`, { cause: error })
    }
  }

  try {
    return normalizeAppBaseUrl(corsOrigins[0] ?? 'http://localhost:5173')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid CORS_ORIGINS: ${message}`, { cause: error })
  }
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins,
  appBaseUrl: resolveAppBaseUrl(),
  emailTransport:
    parsed.data.EMAIL_TRANSPORT ??
    (parsed.data.NODE_ENV === 'production'
      ? 'unavailable'
      : parsed.data.NODE_ENV === 'test'
        ? 'memory'
        : 'log'),
}

export type AppEnv = typeof env
