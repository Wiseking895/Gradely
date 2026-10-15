/**
 * Small in-memory fixed-window rate limiter for login attempts.
 *
 * Trade-offs (documented intentionally):
 *  - Zero dependencies and no database writes on the hot path.
 *  - Serverless caveat: state is per warm function instance, so the limit is
 *    a lower bound under horizontal scaling. It is still effective against
 *    single-connection brute force and credential stuffing per instance.
 *  - A shared store (e.g. Redis or a Neon table) is the natural next step if
 *    stricter global limits are required.
 */

export type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

export type LoginRateLimiter = {
  check(key: string): RateLimitDecision
  recordFailure(key: string): void
  clear(key: string): void
  resetAll(): void
}

type Bucket = { count: number; windowStartedAt: number }

export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_TRACKED_KEYS = 10_000

export function createLoginRateLimiter(options?: {
  maxAttempts?: number
  windowMs?: number
  now?: () => number
}): LoginRateLimiter {
  const maxAttempts = options?.maxAttempts ?? LOGIN_RATE_LIMIT_MAX_ATTEMPTS
  const windowMs = options?.windowMs ?? LOGIN_RATE_LIMIT_WINDOW_MS
  const now = options?.now ?? Date.now
  const buckets = new Map<string, Bucket>()

  function prune(currentTime: number): void {
    if (buckets.size <= MAX_TRACKED_KEYS) {
      return
    }
    for (const [key, bucket] of buckets) {
      if (currentTime - bucket.windowStartedAt >= windowMs) {
        buckets.delete(key)
      }
    }
    // Still over the cap: drop oldest windows first.
    while (buckets.size > MAX_TRACKED_KEYS) {
      const oldest = buckets.keys().next()
      if (oldest.done) {
        break
      }
      buckets.delete(oldest.value)
    }
  }

  return {
    check(key) {
      const bucket = buckets.get(key)
      if (!bucket) {
        return { allowed: true, retryAfterSeconds: 0 }
      }
      const elapsed = now() - bucket.windowStartedAt
      if (elapsed >= windowMs) {
        buckets.delete(key)
        return { allowed: true, retryAfterSeconds: 0 }
      }
      if (bucket.count >= maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
        }
      }
      return { allowed: true, retryAfterSeconds: 0 }
    },
    recordFailure(key) {
      const currentTime = now()
      prune(currentTime)
      const bucket = buckets.get(key)
      if (!bucket || currentTime - bucket.windowStartedAt >= windowMs) {
        buckets.set(key, { count: 1, windowStartedAt: currentTime })
        return
      }
      bucket.count += 1
    },
    clear(key) {
      buckets.delete(key)
    },
    resetAll() {
      buckets.clear()
    },
  }
}

export const defaultLoginRateLimiter = createLoginRateLimiter()
