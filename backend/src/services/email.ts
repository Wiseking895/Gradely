/**
 * Provider-independent email service.
 *
 * Routes and domain services depend only on the `EmailService` interface, so a
 * provider can be replaced without touching caller code.
 *
 * Transports (selected by EMAIL_TRANSPORT, see src/config/env.ts):
 *   - 'log'         development default: console line with recipient/subject.
 *                   The body (verification link) is printed ONLY outside
 *                   production; production logs never contain tokens.
 *   - 'memory'      test default: inspectable outbox, nothing is sent.
 *   - 'unavailable' production default until SMTP is configured: send()
 *                   rejects with a typed config error so callers fail loudly.
 *   - 'smtp'        Nodemailer SMTP adapter (Gmail in the initial production
 *                   plan). Created lazily; TLS verification is always on.
 *
 * Internals live under src/services/email/; this module stays the public barrel
 * so existing imports keep working.
 */

export type { EmailMessage, EmailService } from './email/types.ts'
export type { MemoryEmailService } from './email/transports/memory.ts'
export { createMemoryEmailService } from './email/transports/memory.ts'
export { createConsoleEmailService } from './email/transports/console.ts'
export { createUnavailableEmailService } from './email/transports/unavailable.ts'
export {
  buildSmtpMailOptions,
  buildSmtpTransportOptions,
  createSmtpEmailService,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from './email/transports/smtp.ts'
export type {
  SmtpEmailServiceOptions,
  SmtpTransporterFactory,
} from './email/transports/smtp.ts'
export {
  classifySmtpError,
  EmailDeliveryError,
} from './email/errors.ts'
export type {
  EmailDeliveryErrorKind,
  EmailDeliveryErrorOptions,
} from './email/errors.ts'
export { createEmailService } from './email/factory.ts'
export type {
  CreateEmailServiceOptions,
  EmailTransportKind,
} from './email/factory.ts'
export {
  buildAppLink,
} from './email/templates/links.ts'
export {
  escapeHtml,
  sanitizeHeaderValue,
} from './email/templates/escape.ts'
export {
  renderEmailLayout,
} from './email/templates/layout.ts'
export type {
  EmailLayoutInput,
  RenderedEmailBodies,
} from './email/templates/layout.ts'
export { buildAdminVerificationEmail } from './email/templates/verification.ts'
export type {
  AdminVerificationEmailInput,
  ResendVerificationEmailInput,
} from './email/templates/verification.ts'
export { buildResendVerificationEmail } from './email/templates/verification.ts'
export { buildTeacherInvitationEmail } from './email/templates/invitation.ts'
export type { TeacherInvitationEmailInput } from './email/templates/invitation.ts'
