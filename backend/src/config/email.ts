/**
 * Provider-neutral email configuration.
 *
 * This module owns every rule about how email settings are named, parsed, and
 * validated. Routes and domain services never read SMTP variables directly.
 *
 * Secret handling: the SMTP application password is read from the supplied
 * environment source and returned only inside a short-lived `SmtpConfig`
 * object. It is deliberately NOT part of the exported `env` object, so a stray
 * `console.log(env)` or error dump cannot print it.
 */

/** Configuration error raised before any network connection is attempted. */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

export type NormalizeAppBaseUrlOptions = {
  /**
   * Production deployments must use https. Kept optional so local/preview
   * environments can point at http://localhost.
   */
  requireHttps?: boolean
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Validates and normalises a frontend base URL used to build links inside
 * emails. Only absolute http(s) URLs are accepted, with no embedded
 * credentials, query string, or fragment. Trailing slashes are removed.
 *
 * Rejecting these shapes prevents `javascript:`/`data:` links, credential
 * leaks, and links that would silently drop a path when combined with a
 * template route.
 */
export function normalizeAppBaseUrl(
  raw: string,
  options: NormalizeAppBaseUrlOptions = {},
): string {
  const value = raw.trim()
  if (!value) {
    throw new EmailConfigError('APP_BASE_URL must not be empty')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new EmailConfigError('APP_BASE_URL must be an absolute URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EmailConfigError(
      'APP_BASE_URL must use the http or https protocol',
    )
  }

  if (url.username || url.password) {
    throw new EmailConfigError(
      'APP_BASE_URL must not contain embedded credentials',
    )
  }

  if (url.search || url.hash) {
    throw new EmailConfigError(
      'APP_BASE_URL must not contain a query string or fragment',
    )
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new EmailConfigError(
      'APP_BASE_URL must point at an origin without a path',
    )
  }

  if (options.requireHttps) {
    if (url.protocol !== 'https:') {
      throw new EmailConfigError('APP_BASE_URL must use https in production')
    }
    if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) {
      throw new EmailConfigError(
        'APP_BASE_URL must not point at a loopback host in production',
      )
    }
  }

  return url.origin
}

export type SmtpAuth = {
  user: string
  pass: string
}

export type SmtpConfig = {
  host: string
  port: number
  /** Implicit TLS from the first byte (port 465). */
  secure: boolean
  /** Null for local test relays (Mailpit) that accept unauthenticated mail. */
  auth: SmtpAuth | null
  fromName: string
  fromAddress: string
  appBaseUrl: string
}

export type SmtpConfigResolution =
  | { status: 'configured'; config: SmtpConfig }
  | {
      status: 'incomplete'
      /** Variable names only — never values. */
      missing: readonly string[]
    }

export type ResolveSmtpConfigOptions = {
  /** Used to decide whether APP_BASE_URL must be https. */
  nodeEnv?: string
}

const DEFAULT_SMTP_HOST = 'smtp.gmail.com'
const DEFAULT_SMTP_PORT = 465
const DEFAULT_FROM_NAME = 'Gradely'
const GMAIL_APP_PASSWORD_PATTERN = /^[A-Za-z0-9]{16}$/
const HEADER_BREAK_PATTERN = /[\r\n\u0000]/
const UNSAFE_ADDRESS_PATTERN = /[\s<>(),;:\\"]/

function readValue(
  source: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = source[name]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isGmailHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'gmail.com' || normalized.endsWith('.gmail.com')
}

function parseSmtpPort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_SMTP_PORT
  }
  if (!/^\d+$/.test(raw)) {
    throw new EmailConfigError(
      'SMTP_PORT must be an integer between 1 and 65535',
    )
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailConfigError(
      'SMTP_PORT must be an integer between 1 and 65535',
    )
  }
  return port
}

function parseSmtpSecure(raw: string | undefined): boolean {
  if (raw === undefined) {
    return true
  }
  const normalized = raw.toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  throw new EmailConfigError('SMTP_SECURE must be "true" or "false"')
}

function assertHeaderSafe(value: string, name: string): void {
  if (HEADER_BREAK_PATTERN.test(value)) {
    throw new EmailConfigError(`${name} must not contain line breaks`)
  }
}

function looksLikeEmailAddress(value: string): boolean {
  if (UNSAFE_ADDRESS_PATTERN.test(value)) {
    return false
  }
  const parts = value.split('@')
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}

/**
 * Reads SMTP settings and returns either a usable configuration or the list of
 * missing variable names.
 *
 * Failure policy (approved design):
 *   - Malformed values throw `EmailConfigError` so a broken deployment never
 *     looks healthy.
 *   - Absent credentials return `{ status: 'incomplete' }`; the transport
 *     factory degrades to the unavailable transport and the API keeps serving.
 */
export function resolveSmtpConfig(
  source: NodeJS.ProcessEnv = process.env,
  options: ResolveSmtpConfigOptions = {},
): SmtpConfigResolution {
  const host = readValue(source, 'SMTP_HOST') ?? DEFAULT_SMTP_HOST
  if (host.includes('://') || /[/\s]/.test(host)) {
    throw new EmailConfigError(
      'SMTP_HOST must be a hostname such as smtp.gmail.com',
    )
  }
  const gmail = isGmailHost(host)
  const port = parseSmtpPort(readValue(source, 'SMTP_PORT'))
  const secure = parseSmtpSecure(readValue(source, 'SMTP_SECURE'))

  const fromName = readValue(source, 'EMAIL_FROM_NAME') ?? DEFAULT_FROM_NAME
  assertHeaderSafe(fromName, 'EMAIL_FROM_NAME')

  const fromAddress = readValue(source, 'EMAIL_FROM_ADDRESS') ?? ''
  if (fromAddress) {
    assertHeaderSafe(fromAddress, 'EMAIL_FROM_ADDRESS')
    if (!looksLikeEmailAddress(fromAddress)) {
      throw new EmailConfigError(
        'EMAIL_FROM_ADDRESS must be a valid email address',
      )
    }
  }

  const rawAppBaseUrl = readValue(source, 'APP_BASE_URL')
  const appBaseUrl = rawAppBaseUrl
    ? normalizeAppBaseUrl(rawAppBaseUrl, {
        requireHttps: options.nodeEnv === 'production',
      })
    : ''

  const user = readValue(source, 'SMTP_USER')
  const rawPassword = readValue(source, 'SMTP_APP_PASSWORD')

  if (user && !rawPassword) {
    throw new EmailConfigError(
      'SMTP_USER is set but SMTP_APP_PASSWORD is missing',
    )
  }
  if (!user && rawPassword) {
    throw new EmailConfigError(
      'SMTP_APP_PASSWORD is set but SMTP_USER is missing',
    )
  }

  let auth: SmtpAuth | null = null
  if (user && rawPassword) {
    assertHeaderSafe(user, 'SMTP_USER')
    if (!looksLikeEmailAddress(user)) {
      throw new EmailConfigError('SMTP_USER must be a valid email address')
    }

    // Gmail displays App Passwords in groups of four; accept the pasted form.
    const password = gmail ? rawPassword.replace(/\s+/g, '') : rawPassword
    if (gmail && !GMAIL_APP_PASSWORD_PATTERN.test(password)) {
      throw new EmailConfigError(
        'SMTP_APP_PASSWORD must be a 16-character Gmail App Password (spaces are ignored)',
      )
    }

    auth = { user, pass: password }
  }

  const missing = new Set<string>()
  if (!fromAddress) {
    missing.add('EMAIL_FROM_ADDRESS')
  }
  if (!appBaseUrl) {
    missing.add('APP_BASE_URL')
  }
  if (gmail && !auth) {
    missing.add('SMTP_USER')
    missing.add('SMTP_APP_PASSWORD')
  }

  if (gmail && auth && fromAddress) {
    if (auth.user.toLowerCase() !== fromAddress.toLowerCase()) {
      throw new EmailConfigError(
        'EMAIL_FROM_ADDRESS must match SMTP_USER when sending through Gmail',
      )
    }
  }

  if (missing.size > 0) {
    return { status: 'incomplete', missing: [...missing] }
  }

  return {
    status: 'configured',
    config: {
      host,
      port,
      secure,
      auth,
      fromName,
      fromAddress,
      appBaseUrl,
    },
  }
}
