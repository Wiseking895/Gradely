import { createHash, randomBytes } from 'node:crypto'

/**
 * Email-verification token primitives.
 *
 * - Raw tokens are 32 bytes of CSPRNG output, base64url-encoded (43 chars).
 * - Only the SHA-256 hex digest is ever persisted (email_verification_tokens
 *   .token_hash) or logged by identity; the raw token travels exclusively in
 *   the emailed verification link and is never written to the database.
 * - Same construction as session tokens (src/lib/sessionTokens.ts), kept in
 *   a separate module so session and verification semantics stay distinct.
 */

export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
