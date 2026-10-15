import { createHash, randomBytes } from 'node:crypto'

/**
 * Opaque session tokens.
 *
 * - The raw token (32 random bytes, base64url) is only ever sent to the
 *   client in an HttpOnly cookie; it is never stored server-side and never
 *   logged.
 * - The database stores only the SHA-256 hex digest, so a database leak
 *   cannot be replayed as valid sessions.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
