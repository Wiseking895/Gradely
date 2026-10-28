/**
 * Provider-independent email service.
 *
 * Phase A deliberately ships NO concrete vendor adapter (no SMTP/SendGrid/
 * Resend dependency). Routes depend only on the EmailService interface, so a
 * real provider can be dropped in later without touching route code.
 *
 * Transports (selected by EMAIL_TRANSPORT, see src/config/env.ts):
 *   - 'log'         development default: writes a console line with the
 *                   recipient/subject. The body (which contains the
 *                   verification link) is printed ONLY outside production so
 *                   developers can click through; production logs never
 *                   contain verification tokens.
 *   - 'memory'      test default: keeps messages in an inspectable outbox.
 *                   Nothing is sent anywhere; used with createApp({
 *                   emailService }).
 *   - 'unavailable' production default until a provider is configured:
 *                   send() rejects with EmailDeliveryError, so callers fail
 *                   loudly and honestly instead of silently dropping mail.
 */

export type EmailMessage = {
  to: string
  subject: string
  text: string
}

export interface EmailService {
  /** Resolves on delivery; rejects with EmailDeliveryError (or transport error). */
  send(message: EmailMessage): Promise<void>
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

type MemoryOptions = {
  /** Number of subsequent sends that fail before recovering. */
  failNextSends?: number
  /** Every send fails (used for permanent-failure tests). */
  failAll?: boolean
}

export type MemoryEmailService = EmailService & {
  readonly outbox: EmailMessage[]
  outboxLength(): number
  lastMessage(): EmailMessage | undefined
  /** Messages addressed to a specific recipient, oldest first. */
  messagesFor(email: string): EmailMessage[]
  failNextSends(count: number): void
  failAll(enabled?: boolean): void
  clear(): void
}

export function createMemoryEmailService(
  options?: MemoryOptions,
): MemoryEmailService {
  const outbox: EmailMessage[] = []
  let failing = options?.failAll === true
  let failCount = options?.failNextSends ?? 0

  return {
    outbox,
    outboxLength: () => outbox.length,
    lastMessage: () => outbox[outbox.length - 1],
    messagesFor: (email) => outbox.filter((m) => m.to === email),
    failNextSends: (count) => {
      failCount = count
    },
    failAll: (enabled = true) => {
      failing = enabled
    },
    clear: () => {
      outbox.length = 0
    },
    async send(message) {
      if (failing || failCount > 0) {
        if (failCount > 0) {
          failCount -= 1
        }
        throw new EmailDeliveryError('Simulated email delivery failure')
      }
      outbox.push({ ...message })
    },
  }
}

/** Development transport: console output, no vendor involved. */
export function createConsoleEmailService(options?: {
  /** Print message bodies (verification links) — never true in production. */
  includeBodies?: boolean
}): EmailService {
  const includeBodies = options?.includeBodies === true
  return {
    async send(message) {
      console.log(`[email] to=${message.to} subject="${message.subject}"`)
      if (includeBodies) {
        console.log(`[email] body:\n${message.text}`)
      } else {
        // Production-safe: body may contain a verification token; never log it.
        console.log('[email] body suppressed (may contain a one-time token)')
      }
    },
  }
}

/** Production-default transport until a provider is wired in. */
export function createUnavailableEmailService(): EmailService {
  return {
    async send() {
      throw new EmailDeliveryError(
        'No email transport is configured (set EMAIL_TRANSPORT or add a provider adapter)',
      )
    },
  }
}

export type EmailTransportKind = 'log' | 'memory' | 'unavailable'

export function createEmailService(
  kind: EmailTransportKind,
  options?: { isProduction?: boolean },
): EmailService {
  switch (kind) {
    case 'memory':
      return createMemoryEmailService()
    case 'unavailable':
      return createUnavailableEmailService()
    case 'log':
    default:
      return createConsoleEmailService({
        includeBodies: options?.isProduction !== true,
      })
  }
}
