import { describe, expect, it } from 'vitest'
import {
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from '../src/lib/cookies.ts'
import {
  generateSessionToken,
  hashSessionToken,
} from '../src/lib/sessionTokens.ts'
import { createLoginRateLimiter } from '../src/lib/rateLimit.ts'

describe('session tokens', () => {
  it('generates unique base64url tokens with >= 256 bits of entropy', () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(43)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('hashes tokens to stable 64-char hex digests', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token)).toBe(hash)
    expect(hashSessionToken(generateSessionToken())).not.toBe(hash)
  })
})

describe('readSessionCookie', () => {
  it('reads the session cookie and ignores others', () => {
    const header = `theme=dark; ${SESSION_COOKIE_NAME}=abc123; other=x`
    expect(readSessionCookie(header)).toBe('abc123')
  })

  it('returns null when absent or malformed', () => {
    expect(readSessionCookie(undefined)).toBeNull()
    expect(readSessionCookie('')).toBeNull()
    expect(readSessionCookie('theme=dark')).toBeNull()
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=`)).toBeNull()
  })

  it('decodes URI-encoded values and survives bad encodings', () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=a%2Bb`)).toBe('a+b')
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=%E0%A4%A`)).toBeNull()
  })
})

describe('login rate limiter', () => {
  it('allows attempts until the window limit, then blocks with retryAfter', () => {
    let now = 1_000_000
    const limiter = createLoginRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      now: () => now,
    })

    expect(limiter.check('k').allowed).toBe(true)
    limiter.recordFailure('k')
    limiter.recordFailure('k')
    expect(limiter.check('k').allowed).toBe(true)
    limiter.recordFailure('k')
    const blocked = limiter.check('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)

    // Window elapses → allowed again.
    now += 60_000
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('clears failures after a successful attempt', () => {
    const limiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 60_000 })
    limiter.recordFailure('k')
    limiter.clear('k')
    limiter.recordFailure('k')
    expect(limiter.check('k').allowed).toBe(true)
  })

  it('tracks keys independently and supports resetAll', () => {
    const limiter = createLoginRateLimiter({ maxAttempts: 1, windowMs: 60_000 })
    limiter.recordFailure('a')
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
    limiter.resetAll()
    expect(limiter.check('a').allowed).toBe(true)
  })
})
