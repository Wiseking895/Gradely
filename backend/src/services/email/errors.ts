/**
 * Typed delivery errors and SMTP provider-error classification.
 *
 * Raw provider errors are never rethrown or logged: they can contain the SMTP
 * command stream, authentication exchange, recipient addresses, and message
 * content. Only a small, sanitised classification leaves this module.
 */

export type EmailDeliveryErrorKind =
  /** Worth retrying once (network reset, provider throttling). */
  | 'transient'
  /** The provider will keep rejecting this message; do not retry. */
  | 'permanent'
  /** Credentials or deployment configuration are wrong; alert an operator. */
  | 'config'

export type EmailDeliveryErrorOptions = {
  kind?: EmailDeliveryErrorKind
  /** Short provider code such as EAUTH or a 3-digit SMTP response code. */
  providerCode?: string
  /** Provider-requested cooldown, when it can be read safely. */
  retryAfterSeconds?: number
}

const PROVIDER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class EmailDeliveryError extends Error {
  readonly kind: EmailDeliveryErrorKind
  readonly retryable: boolean
  readonly providerCode?: string
  readonly retryAfterSeconds?: number

  constructor(
    message: string,
    options: EmailDeliveryErrorOptions = {},
  ) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.kind = options.kind ?? 'permanent'
    this.retryable = this.kind === 'transient'
    if (options.providerCode !== undefined) {
      this.providerCode = options.providerCode
    }
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds
    }
  }
}

const CONFIG_CODES = new Set(['EAUTH', 'ELOGIN'])
const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNRESET',
  'EDNS',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
])
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE'])
const TRANSIENT_RESPONSE_CODES = new Set([421, 450, 451, 452, 454])
const PERMANENT_RESPONSE_CODES = new Set([550, 551, 552, 553, 554])
const AUTH_RESPONSE_CODE = 535

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function readStringCode(record: Record<string, unknown> | null): string | undefined {
  const value = record?.code
  return typeof value === 'string' && PROVIDER_CODE_PATTERN.test(value)
    ? value
    : undefined
}

function readResponseCode(
  record: Record<string, unknown> | null,
): number | undefined {
  const value = record?.responseCode
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined
}

function readRetryAfterSeconds(
  record: Record<string, unknown> | null,
): number | undefined {
  const value = record?.retryAfter ?? record?.retryAfterSeconds
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined
}

function providerCodeFor(
  code: string | undefined,
  responseCode: number | undefined,
): string | undefined {
  if (code) {
    return code
  }
  return responseCode === undefined ? undefined : String(responseCode)
}

/**
 * Maps an unknown Nodemailer/SMTP error to a safe, typed error.
 *
 * The resulting message never includes the original error text, recipient,
 * message body, or credentials. Unknown errors default to `permanent` so a
 * caller cannot accidentally hammer a provider with unclassified failures.
 */
export function classifySmtpError(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) {
    return error
  }

  const record = asRecord(error)
  const code = readStringCode(record)
  const responseCode = readResponseCode(record)
  const retryAfterSeconds = readRetryAfterSeconds(record)
  const providerCode = providerCodeFor(code, responseCode)

  if ((code && CONFIG_CODES.has(code)) || responseCode === AUTH_RESPONSE_CODE) {
    return new EmailDeliveryError('SMTP authentication failed', {
      kind: 'config',
      providerCode,
    })
  }

  if (
    (code && TRANSIENT_CODES.has(code)) ||
    (responseCode !== undefined && TRANSIENT_RESPONSE_CODES.has(responseCode))
  ) {
    return new EmailDeliveryError('SMTP delivery failed temporarily', {
      kind: 'transient',
      providerCode,
      retryAfterSeconds,
    })
  }

  if (
    (code && PERMANENT_CODES.has(code)) ||
    (responseCode !== undefined && PERMANENT_RESPONSE_CODES.has(responseCode))
  ) {
    return new EmailDeliveryError('SMTP provider rejected the message', {
      kind: 'permanent',
      providerCode,
    })
  }

  return new EmailDeliveryError('SMTP delivery failed', {
    kind: 'permanent',
    providerCode,
  })
}
