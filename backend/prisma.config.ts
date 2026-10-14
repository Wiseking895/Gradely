import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI commands (migrate, db push, db pull) always use this URL.
    // With a pooled database provider, point DIRECT_URL at the unpooled
    // connection; the runtime Prisma Client uses pooled DATABASE_URL through
    // the @prisma/adapter-pg driver adapter (see src/lib/prisma.ts).
    // Falls back to DATABASE_URL for simple local setups, and stays unset
    // (harmless) on builds like Vercel that only run `prisma generate`.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
})
