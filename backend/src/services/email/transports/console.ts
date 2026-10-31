import type { EmailService } from '../types.ts'

/**
 * Development transport: console output, no vendor involved.
 *
 * Outside production the body (including any one-time link) is printed so a
 * developer can click through. In production the body is always suppressed —
 * verification and invitation tokens must never reach production logs.
 */
export function createConsoleEmailService(options?: {
  /** Print message bodies (links/tokens) — never true in production. */
  includeBodies?: boolean
}): EmailService {
  const includeBodies = options?.includeBodies === true
  return {
    async send(message) {
      console.log(`[email] to=${message.to} subject="${message.subject}"`)
      if (includeBodies) {
        console.log(`[email] body:\n${message.text}`)
      } else {
        console.log('[email] body suppressed (may contain a one-time token)')
      }
    },
  }
}
