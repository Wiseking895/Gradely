# Gradely — Backend

Node.js + TypeScript + Express API for Gradely, with Prisma ORM for
PostgreSQL, deployed as a Vercel Function.

> **Status:** Phase 1.5 (deployment-ready foundation). Only a health
> endpoint exists. School registration, authentication, pupils, teachers,
> scoring, report generation, and payments belong to later phases.

## Stack

- Node.js 24 (ESM), TypeScript, Express 5
- Prisma 7 + `@prisma/adapter-pg` (driver adapter) + PostgreSQL
- Cloudflare R2 via `@aws-sdk/client-s3` (S3-compatible)
- Zod for environment validation
- Helmet + environment-driven CORS
- ESLint 10 + typescript-eslint, Vitest + Supertest

## Deploying to Vercel (backend project)

Import the same Git repository as a **second** Vercel project with:

- **Root Directory:** `backend`
- **Framework Preset:** Express (auto-detected; also set in `vercel.json`)
- **Node.js version:** 24.x (pinned via `engines` in `package.json`)

Vercel detects `src/app.ts`, which default-exports the Express app, and
serves it as a single Vercel Function. `vercel.json` sets
`buildCommand: prisma generate` so the Prisma client exists before Vercel
bundles the function.

Set the environment variables below in the Vercel project (Production,
Preview, Development as appropriate). Never commit real credentials.

## Environment variables (backend Vercel project)

| Variable | Required | Purpose |
| --- | --- | --- |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed frontend origins, e.g. `https://your-frontend.vercel.app` |
| `DATABASE_URL` | Yes (when DB features ship) | **Pooled** PostgreSQL connection used by Prisma Client at runtime |
| `DIRECT_URL` | Yes (for migrations) | **Unpooled** PostgreSQL connection used by Prisma CLI (`migrate`, `db push`) |
| `NODE_ENV` | Optional | Set by Vercel to `production`; defaults to `development` locally |
| `PORT` | No | Local dev only; ignored on Vercel |
| `R2_ACCOUNT_ID` | For storage | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | For storage | R2 API token access key (Object Read & Write on one bucket) |
| `R2_SECRET_ACCESS_KEY` | For storage | R2 API token secret key |
| `R2_BUCKET_NAME` | For storage | R2 bucket name (e.g. `gradely-files`) |
| `R2_PUBLIC_BASE_URL` | No | Optional public base URL for non-private assets only |

The API and `GET /api/health` start **without** database or R2 credentials.

## Local development

```bash
npm install               # install dependencies
copy .env.example .env    # then edit values (placeholders only in the example)
npm run prisma:generate   # required once after install
npm run dev               # API on http://localhost:4000
```

`.env` is gitignored. Never commit real credentials. A local PostgreSQL
server is **not** required to start the API or pass the health check.

## Commands

```bash
npm run dev             # start API with hot reload (tsx watch) on :4000
npm run build           # compile TypeScript to dist/ (local production run)
npm start               # run the compiled API (requires npm run build)
npm run lint            # ESLint
npm run typecheck       # TypeScript check (no emit)
npm test                # Vitest + Supertest tests
npm run prisma:validate # validate prisma/schema.prisma
npm run prisma:generate # regenerate the Prisma client into src/generated/prisma
```

## Health endpoint

```
GET /api/health
```

Returns `200` with service status, environment, and uptime. It deliberately
does **not** touch the database or R2, so the API starts and answers health
checks without external services. Access is lazy:
`getPrisma()` (`src/lib/prisma.ts`) and `getR2Client()` (`src/lib/r2.ts`)
create their clients on first use only.

## Database (Prisma + PostgreSQL)

- Runtime queries use the **pooled** connection (`DATABASE_URL`) through
  the `@prisma/adapter-pg` driver adapter — the pattern for Neon, Supabase,
  and any PgBouncer-style provider on serverless hosts.
- Prisma CLI/migrations use the **direct** connection (`DIRECT_URL`),
  configured in `prisma.config.ts` (Prisma 7 replaced `directUrl` in
  `schema.prisma` with `datasource.url` in the config file).
- `getPrisma()` returns a module-level singleton reused per warm function
  instance; a new PrismaClient is never created per request.
- **Provider choice is pending approval** — no real connection strings are
  configured and no migrations have been run.

## Cloudflare R2 (file storage)

`src/lib/r2.ts` prepares S3-compatible access for school logos, pupil
photographs, generated report PDFs, and other school documents:

- Credentials stay in backend environment variables (never sent to the
  browser; the frontend cannot reach R2 directly).
- Objects are private by default; clients get short-lived presigned URLs
  generated server-side (default 5 minutes).
- Uploads must pass `assertValidUpload()` (MIME allow-list, 10 MB size cap);
  keys are namespaced per school via `buildObjectKey()` so ownership can be
  enforced in later phases.
- Files are never written to the function's local disk (it does not persist
  across serverless invocations).
- No bucket has been created and no upload has been tested — R2 credentials
  and authorization are still required.

## Architecture notes (serverless)

- `src/app.ts` default-exports the Express app (Vercel zero-config
  detection); `src/index.ts` is the local `app.listen` entry.
- No persistent local disk or in-memory state is used for durable data —
  PostgreSQL and R2 are the durable stores.
- Errors return JSON without stack traces; 5xx details are only logged
  server-side.

## Structure

```
backend/
  vercel.json            # buildCommand: prisma generate; framework: express
  prisma.config.ts       # Prisma CLI datasource (DIRECT_URL ?? DATABASE_URL)
  prisma/schema.prisma   # minimal schema — no domain models yet
  src/
    index.ts             # local server entry (loads env, app.listen)
    app.ts               # Express app + Vercel default export
    config/env.ts        # Zod-validated environment variables
    lib/prisma.ts        # lazy Prisma client singleton (adapter-pg)
    lib/r2.ts            # lazy R2 client + presigned URLs + validation
    middleware/          # 404 + centralized error handling
    routes/health.ts     # GET /api/health
  tests/                 # Vitest tests (health, 404, R2 validation)
```

The Prisma client is generated into `src/generated/prisma` (gitignored);
run `npm run prisma:generate` after a fresh install (Vercel does this via
`buildCommand`).
