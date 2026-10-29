import path from 'node:path'
import { config } from 'dotenv'

/**
 * Explicit environment loading for local entry points.
 *
 * Normal local development keeps the historical behavior: load `.env` from the
 * current working directory. Scratch commands must select an explicit file with
 * GRADELY_ENV_FILE (or set GRADELY_ENV=scratch and select one). In scratch mode
 * there is deliberately no fallback to `.env`, because `backend/.env` may
 * contain production Neon credentials.
 */

const explicitFile = process.env.GRADELY_ENV_FILE?.trim()
const scratchMode =
  process.env.GRADELY_ENV === 'scratch' || process.argv.includes('--scratch')

if (explicitFile) {
  const resolved = path.resolve(process.cwd(), explicitFile)

  if (scratchMode && path.basename(resolved) === '.env') {
    throw new Error(
      'Scratch mode must not load a file named .env; select a scratch-only environment file',
    )
  }

  const result = config({ path: resolved, override: false, quiet: true })
  if (result.error) {
    throw new Error(
      `Failed to load GRADELY_ENV_FILE: ${result.error.message}`,
    )
  }
} else if (scratchMode) {
  throw new Error(
    'Scratch mode requires GRADELY_ENV_FILE pointing at a scratch-only environment file; refusing to load .env',
  )
} else {
  config({ quiet: true })
}
