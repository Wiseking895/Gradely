import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with Node's built-in scrypt (OWASP Password Storage
 * Cheat Sheet recommendations: N=2^17, r=8, p=1, >=64-byte derived key).
 * No third-party dependency is required.
 *
 * Stored format (self-describing, so parameters can be raised later
 * without invalidating existing hashes):
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * Passwords are never logged, never returned by the API, and never stored
 * in plaintext. Verification is constant-time and never throws on
 * malformed input (malformed simply fails verification).
 */

const SCRYPT_N = 131072 // 2^17
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
// scrypt needs approximately 128 * N * r bytes; Node's default maxmem (32 MB)
// is too small for N=2^17, so give it headroom.
const SCRYPT_MAXMEM = 256 * 1024 * 1024

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      keylen,
      options,
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false
  }

  const N = Number.parseInt(parts[1], 10)
  const r = Number.parseInt(parts[2], 10)
  const p = Number.parseInt(parts[3], 10)
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 1024 ||
    r < 1 ||
    p < 1 ||
    N > 1 << 20
  ) {
    return false
  }

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) {
    return false
  }

  let actual: Buffer
  try {
    actual = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })
  } catch {
    return false
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * A per-process dummy hash used to equalise timing when an email does not
 * exist, so login responses cannot be used to probe which accounts exist.
 * Generated lazily on first use.
 */
let dummyHashPromise: Promise<string> | undefined

async function getDummyHash(): Promise<string> {
  if (dummyHashPromise === undefined) {
    dummyHashPromise = hashPassword(randomBytes(24).toString('base64'))
  }
  return dummyHashPromise
}

/**
 * Burns an equivalent amount of scrypt work for a non-existent account.
 * Always returns false.
 */
export async function verifyPasswordDummy(password: string): Promise<boolean> {
  const dummy = await getDummyHash()
  await verifyPassword(password, dummy)
  return false
}
