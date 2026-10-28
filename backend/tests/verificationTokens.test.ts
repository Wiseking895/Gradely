import { describe, expect, it } from 'vitest'
import {
  generateVerificationToken,
  hashVerificationToken,
} from '../src/lib/verificationTokens.ts'

describe('verification tokens', () => {
  it('generates unique base64url tokens with >= 256 bits of entropy', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      tokens.add(generateVerificationToken())
    }
    expect(tokens.size).toBe(100)
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('hashes to a stable 64-char hex digest of the raw token only', () => {
    const token = generateVerificationToken()
    const hash = hashVerificationToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashVerificationToken(token)).toBe(hash)
    expect(hashVerificationToken(generateVerificationToken())).not.toBe(hash)
  })

  it('is sensitive to every character of the raw token', () => {
    const token = generateVerificationToken()
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    expect(hashVerificationToken(tampered)).not.toBe(hashVerificationToken(token))
  })
})
