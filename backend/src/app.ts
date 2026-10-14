import cors from 'cors'
import express, { type Express } from 'express'
import * as helmetModule from 'helmet'
import { env } from './config/env.ts'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts'
import { healthRouter } from './routes/health.ts'

// helmet ships as a dual CJS/ESM package. Taking the default export from a
// namespace import resolves identically under every TypeScript module mode
// (NodeNext ESM, CJS interop, editor default configs), unlike a plain
// default import which can be typed as the non-callable module namespace.
const helmet = helmetModule.default

/**
 * Builds the Express application. No database connection is opened here.
 */
export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')

  // Behind Vercel's proxy (and any reverse proxy) so req.protocol/req.ip
  // reflect the original client request.
  app.set('trust proxy', 1)

  app.use(helmet())

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (no Origin header) and configured origins.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true)
          return
        }
        callback(null, false)
      },
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use('/api', healthRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

/**
 * Default export used by Vercel's zero-configuration Express detection
 * (recognized entry: src/app.ts). Vercel bundles this app as a single
 * Function; locally, src/index.ts listens on a port with the same app.
 */
const app = createApp()

export default app
