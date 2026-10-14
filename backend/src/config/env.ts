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

  // Database (PostgreSQL via Prisma + driver adapter).
  // DATABASE_URL: pooled runtime connection (e.g. PgBouncer/Neon pooler).
  DATABASE_URL: optionalEnvString,
  // DIRECT_URL: unpooled connection used by Prisma CLI (migrations).
  DIRECT_URL: optionalEnvString,

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
}

export type AppEnv = typeof env
