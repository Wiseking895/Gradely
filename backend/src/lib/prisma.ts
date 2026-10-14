import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { env } from '../config/env.ts'

let prismaClient: PrismaClient | undefined

/**
 * Returns the shared Prisma client, creating it on first use.
 *
 * - Created lazily so starting the API never requires a reachable
 *   PostgreSQL server; connections open only when a query runs.
 * - Uses the pooled runtime connection (DATABASE_URL). Migrations use the
 *   direct connection (DIRECT_URL) through prisma.config.ts instead.
 * - Reused per warm serverless instance on Vercel; a new PrismaClient is
 *   never created per request.
 */
export function getPrisma(): PrismaClient {
  if (prismaClient === undefined) {
    if (!env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and configure your database connection string.',
      )
    }
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
    prismaClient = new PrismaClient({ adapter })
  }
  return prismaClient
}
