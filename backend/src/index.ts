import './config/loadEnv.ts'
import { createApp } from './app.ts'
import { env } from './config/env.ts'

if (env.GRADELY_ENV === 'scratch' && !env.DATABASE_URL) {
  throw new Error(
    'GRADELY_ENV=scratch requires DATABASE_URL in the selected scratch environment file',
  )
}

const app = createApp()

const server = app.listen(env.PORT, () => {
  console.log(`Gradely API listening on http://localhost:${env.PORT}`)
  console.log(`Environment: ${env.NODE_ENV}`)
  console.log(
    'Database connectivity is optional at startup; configure DATABASE_URL before running migrations.',
  )
})

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down gracefully.`)
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
