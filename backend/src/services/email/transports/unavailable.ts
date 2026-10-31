import { EmailDeliveryError } from '../errors.ts'
import type { EmailService } from '../types.ts'

/**
 * Safe default when no provider is configured (and when SMTP is selected but
 * incomplete). `send()` rejects loudly with a `config` error so callers fail
 * honestly instead of silently dropping mail. The message is static and never
 * contains credentials or configuration values.
 */
export function createUnavailableEmailService(reason?: string): EmailService {
  return {
    async send() {
      throw new EmailDeliveryError(
        reason ??
          'No email transport is configured (set EMAIL_TRANSPORT or add a provider adapter)',
        { kind: 'config' },
      )
    },
  }
}
