import { EmailDeliveryError } from '../errors.ts'
import type { EmailMessage, EmailService } from '../types.ts'

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

/**
 * Test transport: keeps messages in an inspectable outbox. Nothing is sent
 * anywhere. Pass it to `createApp({ emailService })` in tests.
 */
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
        throw new EmailDeliveryError('Simulated email delivery failure', {
          kind: 'transient',
        })
      }
      outbox.push({ ...message })
    },
  }
}
