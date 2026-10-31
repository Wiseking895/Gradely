import nodemailer from 'nodemailer'
import type {
  SendMailOptions,
  SentMessageInfo,
  SMTPTransportOptions,
  Transporter,
} from 'nodemailer'
import type { SmtpConfig } from '../../../config/email.ts'
import { classifySmtpError, EmailDeliveryError } from '../errors.ts'
import type { EmailMessage, EmailService } from '../types.ts'

/**
 * Bounded SMTP budgets. Vercel freezes instances between invocations, so the
 * adapter opens a fresh (unpooled) connection per send and caps every phase.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 5_000
export const SMTP_GREETING_TIMEOUT_MS = 5_000
export const SMTP_SOCKET_TIMEOUT_MS = 10_000

export type SmtpTransporterFactory = (config: SmtpConfig) => Transporter

/**
 * Builds the Nodemailer transport options.
 *
 * TLS certificate verification is never disabled; STARTTLS is mandatory when
 * implicit TLS is off. File and URL access are disabled so a crafted message
 * cannot make the server read local files or fetch remote resources.
 */
export function buildSmtpTransportOptions(
  config: SmtpConfig,
): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: config.auth ?? undefined,
    // Serverless-safe: a pooled socket can be dead after an instance freezes.
    pool: false,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  }
}

function createDefaultTransporter(config: SmtpConfig): Transporter {
  return nodemailer.createTransport(buildSmtpTransportOptions(config))
}

const HEADER_BREAK_PATTERN = /[\r\n]/
const RECIPIENT_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+$/

function assertDeliverableRecipient(to: string): void {
  if (HEADER_BREAK_PATTERN.test(to) || !RECIPIENT_PATTERN.test(to)) {
    throw new EmailDeliveryError('Recipient address is not a valid email address', {
      kind: 'permanent',
      providerCode: 'EENVELOPE',
    })
  }
}

function assertSafeSubject(subject: string): void {
  if (HEADER_BREAK_PATTERN.test(subject)) {
    throw new EmailDeliveryError(
      'Email subject must not contain line breaks',
      { kind: 'permanent', providerCode: 'EMESSAGE' },
    )
  }
  if (!subject.trim()) {
    throw new EmailDeliveryError('Email subject must not be empty', {
      kind: 'permanent',
      providerCode: 'EMESSAGE',
    })
  }
}

/**
 * Builds the message object handed to Nodemailer. Exported for tests so the
 * exact wire shape can be asserted without opening a socket.
 */
export function buildSmtpMailOptions(
  config: SmtpConfig,
  message: EmailMessage,
): SendMailOptions {
  assertDeliverableRecipient(message.to)
  assertSafeSubject(message.subject)

  return {
    from: { name: config.fromName, address: config.fromAddress },
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
    // Explicit envelope: nothing user-controlled can add recipients or
    // override the sender outside the visible headers.
    envelope: { from: config.fromAddress, to: [message.to] },
    headers: { 'X-Auto-Response-Suppress': 'All' },
  }
}

/** Keeps only characters that are safe in a log line. */
function sanitizeLogValue(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  return text.replace(/[^A-Za-z0-9@._<>-]/g, '').slice(0, 128) || 'unknown'
}

export type SmtpEmailServiceOptions = {
  /** Test seam; defaults to `nodemailer.createTransport`. */
  transporterFactory?: SmtpTransporterFactory
  /** Test seam; defaults to console. Only message IDs are ever logged. */
  logger?: Pick<Console, 'log'>
}

/**
 * Nodemailer SMTP adapter.
 *
 * Design notes:
 *   - The transporter is created lazily on the first send, so importing the
 *     app never opens a socket and cold starts do not pay for a TLS handshake.
 *   - Success logs contain only the provider message ID. Recipients, subjects,
 *     bodies, tokens, and the App Password are never logged.
 *   - Failures are converted to EmailDeliveryError, and the raw provider error
 *     is discarded (it can contain the SMTP exchange and credentials).
 */
export function createSmtpEmailService(
  config: SmtpConfig,
  options: SmtpEmailServiceOptions = {},
): EmailService {
  const transporterFactory = options.transporterFactory ?? createDefaultTransporter
  const logger = options.logger ?? console
  let transporter: Transporter | undefined

  return {
    async send(message: EmailMessage): Promise<void> {
      const mail = buildSmtpMailOptions(config, message)

      transporter ??= transporterFactory(config)

      let info: SentMessageInfo
      try {
        info = await transporter.sendMail(mail)
      } catch (error) {
        throw classifySmtpError(error)
      }

      if (
        Array.isArray(info.rejected) &&
        info.rejected.length > 0 &&
        (!Array.isArray(info.accepted) || info.accepted.length === 0)
      ) {
        throw new EmailDeliveryError('SMTP provider rejected the recipient', {
          kind: 'permanent',
          providerCode: 'EENVELOPE',
        })
      }

      logger.log(
        `[email] smtp delivered messageId=${sanitizeLogValue(info.messageId)}`,
      )
    },
  }
}
