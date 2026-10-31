/**
 * Public email contract.
 *
 * Routes and domain services depend only on `EmailService`; no caller knows
 * whether delivery happens over SMTP, a memory outbox, or a disabled
 * transport.
 */

export type EmailMessage = {
  /** Validated recipient address. */
  to: string
  /** Single-line subject; must not contain CR/LF. */
  subject: string
  /** Plain-text body. Always required so every client has a readable copy. */
  text: string
  /** Optional HTML alternative rendered from the shared template layout. */
  html?: string
}

export interface EmailService {
  /** Resolves on delivery; rejects with EmailDeliveryError (or transport error). */
  send(message: EmailMessage): Promise<void>
}
