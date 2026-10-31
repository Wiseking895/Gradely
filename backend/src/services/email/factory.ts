import type { SmtpConfigResolution } from '../../config/email.ts'
import { createConsoleEmailService } from './transports/console.ts'
import { createMemoryEmailService } from './transports/memory.ts'
import {
  createSmtpEmailService,
  type SmtpTransporterFactory,
} from './transports/smtp.ts'
import { createUnavailableEmailService } from './transports/unavailable.ts'
import type { EmailService } from './types.ts'

export type EmailTransportKind = 'log' | 'memory' | 'unavailable' | 'smtp'

export type CreateEmailServiceOptions = {
  /** Controls whether the log transport prints bodies (links/tokens). */
  isProduction?: boolean
  /**
   * Result of `resolveSmtpConfig`. Only required when `kind === 'smtp'`.
   *
   * A configured result creates the Nodemailer adapter. An incomplete result
   * degrades to the unavailable transport with one sanitised log line so the
   * API (health, login, CORS) keeps serving instead of failing at boot.
   */
  smtp?: SmtpConfigResolution
  /** Test seam forwarded to the SMTP adapter. */
  smtpTransporterFactory?: SmtpTransporterFactory
  /** Test seam; defaults to console. */
  logger?: Pick<Console, 'log' | 'error'>
}

/**
 * Transport factory. Routes never call this directly — `app.ts` selects a
 * transport from `EMAIL_TRANSPORT` once per instance.
 */
export function createEmailService(
  kind: EmailTransportKind,
  options: CreateEmailServiceOptions = {},
): EmailService {
  switch (kind) {
    case 'memory':
      return createMemoryEmailService()
    case 'unavailable':
      return createUnavailableEmailService()
    case 'smtp': {
      if (options.smtp?.status === 'configured') {
        return createSmtpEmailService(options.smtp.config, {
          transporterFactory: options.smtpTransporterFactory,
          logger: options.logger,
        })
      }

      const logger = options.logger ?? console
      const missing =
        options.smtp?.status === 'incomplete'
          ? options.smtp.missing.join(', ')
          : 'SMTP configuration was not provided'
      logger.error(
        `[email] EMAIL_TRANSPORT=smtp is not usable (missing: ${missing}). Email delivery is disabled.`,
      )
      return createUnavailableEmailService(
        'SMTP email transport is selected but not fully configured',
      )
    }
    case 'log':
    default:
      return createConsoleEmailService({
        includeBodies: options.isProduction !== true,
      })
  }
}
