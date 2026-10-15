import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  verifyPasswordDummy,
} from '../src/lib/passwords.ts'

describe('password hashing', () => {
  it('hashes with the scrypt format and never stores the plaintext', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(stored).not.toContain('correct horse')
    expect(stored.split('$')).toHaveLength(6)
  })

  it('uses a fresh salt for every hash', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
  })

  it('verifies the correct password and rejects wrong passwords', async () => {
    const stored = await hashPassword('s3cure-Passw0rd!')
    await expect(verifyPassword('s3cure-Passw0rd!', stored)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)
    await expect(verifyPassword('', stored)).resolves.toBe(false)
  })

  it('rejects malformed or tampered stored hashes without throwing', async () => {
    await expect(verifyPassword('any', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('any', 'scrypt$$$$')).resolves.toBe(false)
    await expect(verifyPassword('any', 'bcrypt$1$2$3$4$5')).resolves.toBe(false)
    await expect(
      verifyPassword('any', 'scrypt$999999999$8$1$YWFh$YWFh'),
    ).resolves.toBe(false)
  })

  it('dummy verification always fails (timing equalisation for unknown users)', async () => {
    await expect(verifyPasswordDummy('anything')).resolves.toBe(false)
    await expect(verifyPasswordDummy('anything-else')).resolves.toBe(false)
  })
})
