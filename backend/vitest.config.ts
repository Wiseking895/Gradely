import { defineConfig } from 'vitest/config'

/**
 * Auth tests run real scrypt hashing (CPU + ~128 MB per operation).
 * Running test files in parallel workers contends for CPU/memory and can
 * push individual tests past the default 5s timeout, so files run
 * sequentially here with generous, still-bounded timeouts.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
