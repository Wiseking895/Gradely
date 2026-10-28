import { z } from 'zod'

/** Treats missing or blank values as unset; everything else must be non-empty. */
const optionalEnvString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
)

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
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

  // Email transport for the verification flow (src/services/email.ts).
  // Unset resolves to: production -> 'unavailable' (fail loudly, no vendor
  // dependency yet), test -> 'memory', development -> 'log'.
  EMAIL_TRANSPORT: z.enum(['log', 'memory', 'unavailable']).optional(),

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

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  emailTransport:
    parsed.data.EMAIL_TRANSPORT ??
    (parsed.data.NODE_ENV === 'production'
      ? 'unavailable'
      : parsed.data.NODE_ENV === 'test'
        ? 'memory'
        : 'log'),
}

export type AppEnv = typeof env
