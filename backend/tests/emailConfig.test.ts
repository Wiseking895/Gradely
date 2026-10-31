import { describe, expect, it } from 'vitest'
import {
  EmailConfigError,
  normalizeAppBaseUrl,
  resolveSmtpConfig,
} from '../src/config/email.ts'

const GMAIL_ENV = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'gradely.test@gmail.com',
  SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop',
  EMAIL_FROM_NAME: 'Gradely',
  EMAIL_FROM_ADDRESS: 'gradely.test@gmail.com',
  APP_BASE_URL: 'https://gradely-frontend.vercel.app/',
}

const CUSTOM_SMTP_ENV = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'mailer@example.test',
  SMTP_APP_PASSWORD: 'provider-specific-password',
  EMAIL_FROM_NAME: 'Gradely',
  EMAIL_FROM_ADDRESS: 'no-reply@example.test',
  APP_BASE_URL: 'https://gradely.example.test',
}

describe('normalizeAppBaseUrl', () => {
  it('normalises a trailing slash away', () => {
    expect(normalizeAppBaseUrl('https://gradely-frontend.vercel.app/')).toBe(
      'https://gradely-frontend.vercel.app',
    )
  })

  it('accepts http for local development', () => {
    expect(normalizeAppBaseUrl('http://localhost:5173')).toBe(
      'http://localhost:5173',
    )
  })

  it('requires https in production mode', () => {
    expect(() =>
      normalizeAppBaseUrl('http://gradely.example.test', { requireHttps: true }),
    ).toThrow(EmailConfigError)
  })

  it('rejects loopback hosts in production mode', () => {
    expect(() =>
      normalizeAppBaseUrl('https://localhost:5173', { requireHttps: true }),
    ).toThrow(EmailConfigError)
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,hello'],
    ['/verify-email'],
    ['not a url'],
    ['https://user:secret@example.test'],
    ['https://example.test/path'],
    ['https://example.test/?next=evil'],
    ['https://example.test/#fragment'],
    ['   '],
  ])('rejects unsafe configuration %s', (value) => {
    expect(() => normalizeAppBaseUrl(value)).toThrow(EmailConfigError)
  })
})

describe('resolveSmtpConfig', () => {
  it('resolves a complete Gmail configuration and strips App Password spaces', () => {
    const result = resolveSmtpConfig(GMAIL_ENV, { nodeEnv: 'production' })

    expect(result.status).toBe('configured')
    if (result.status !== 'configured') {
      return
    }

    expect(result.config).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      fromName: 'Gradely',
      fromAddress: 'gradely.test@gmail.com',
      appBaseUrl: 'https://gradely-frontend.vercel.app',
    })
    expect(result.config.auth).toEqual({
      user: 'gradely.test@gmail.com',
      pass: 'abcdefghijklmnop',
    })
  })

  it('applies Gmail defaults when host, port, secure, and name are omitted', () => {
    const result = resolveSmtpConfig(
      {
        SMTP_USER: 'gradely.test@gmail.com',
        SMTP_APP_PASSWORD: 'abcdefghijklmnop',
        EMAIL_FROM_ADDRESS: 'gradely.test@gmail.com',
        APP_BASE_URL: 'https://gradely-frontend.vercel.app',
      },
      { nodeEnv: 'production' },
    )

    expect(result.status).toBe('configured')
    if (result.status !== 'configured') {
      return
    }
    expect(result.config.host).toBe('smtp.gmail.com')
    expect(result.config.port).toBe(465)
    expect(result.config.secure).toBe(true)
    expect(result.config.fromName).toBe('Gradely')
  })

  it('supports a non-Gmail provider with STARTTLS and a provider-specific password', () => {
    const result = resolveSmtpConfig(CUSTOM_SMTP_ENV, { nodeEnv: 'production' })

    expect(result.status).toBe('configured')
    if (result.status !== 'configured') {
      return
    }
    expect(result.config.port).toBe(587)
    expect(result.config.secure).toBe(false)
    expect(result.config.auth?.pass).toBe('provider-specific-password')
  })

  it('supports an unauthenticated local relay', () => {
    const result = resolveSmtpConfig(
      {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        EMAIL_FROM_ADDRESS: 'no-reply@localhost',
        APP_BASE_URL: 'http://localhost:5173',
      },
      { nodeEnv: 'development' },
    )

    expect(result.status).toBe('configured')
    if (result.status !== 'configured') {
      return
    }
    expect(result.config.auth).toBeNull()
  })

  it('reports missing variable names (never values) when incomplete', () => {
    const result = resolveSmtpConfig(
      { SMTP_HOST: 'smtp.example.test' },
      { nodeEnv: 'development' },
    )

    expect(result).toEqual({
      status: 'incomplete',
      missing: ['EMAIL_FROM_ADDRESS', 'APP_BASE_URL'],
    })
  })

  it('reports missing Gmail credentials as incomplete rather than throwing', () => {
    const result = resolveSmtpConfig(
      {
        EMAIL_FROM_ADDRESS: 'gradely.test@gmail.com',
        APP_BASE_URL: 'https://gradely-frontend.vercel.app',
      },
      { nodeEnv: 'production' },
    )

    expect(result.status).toBe('incomplete')
    if (result.status !== 'incomplete') {
      return
    }
    expect(result.missing).toContain('SMTP_USER')
    expect(result.missing).toContain('SMTP_APP_PASSWORD')
  })

  it('rejects a half-configured credential pair', () => {
    expect(() =>
      resolveSmtpConfig({ SMTP_USER: 'mailer@example.test' }, {}),
    ).toThrow(/SMTP_APP_PASSWORD is missing/)

    expect(() =>
      resolveSmtpConfig(
        { SMTP_APP_PASSWORD: 'abcdefghijklmnop' },
        {},
      ),
    ).toThrow(/SMTP_USER is missing/)
  })

  it('rejects a Gmail sender that does not match the authenticated user', () => {
    expect(() =>
      resolveSmtpConfig(
        {
          ...GMAIL_ENV,
          EMAIL_FROM_ADDRESS: 'someone-else@gmail.com',
        },
        {},
      ),
    ).toThrow(/must match SMTP_USER/)
  })

  it('rejects malformed ports and booleans', () => {
    expect(() =>
      resolveSmtpConfig({ ...CUSTOM_SMTP_ENV, SMTP_PORT: 'abc' }, {}),
    ).toThrow(/SMTP_PORT/)

    expect(() =>
      resolveSmtpConfig({ ...CUSTOM_SMTP_ENV, SMTP_PORT: '70000' }, {}),
    ).toThrow(/SMTP_PORT/)

    expect(() =>
      resolveSmtpConfig({ ...CUSTOM_SMTP_ENV, SMTP_SECURE: 'yes' }, {}),
    ).toThrow(/SMTP_SECURE/)
  })

  it('rejects a malformed Gmail App Password without echoing the value', () => {
    const secret = 'not-a-valid-password'
    let caught: unknown
    try {
      resolveSmtpConfig(
        { ...GMAIL_ENV, SMTP_APP_PASSWORD: secret },
        {},
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(EmailConfigError)
    expect((caught as Error).message).not.toContain(secret)
  })

  it('rejects header injection in the sender name', () => {
    expect(() =>
      resolveSmtpConfig(
        { ...CUSTOM_SMTP_ENV, EMAIL_FROM_NAME: 'Gradely\r\nBcc: evil@example.test' },
        {},
      ),
    ).toThrow(/line breaks/)
  })

  it('rejects invalid sender addresses and host URLs', () => {
    expect(() =>
      resolveSmtpConfig(
        { ...CUSTOM_SMTP_ENV, EMAIL_FROM_ADDRESS: 'not-an-address' },
        {},
      ),
    ).toThrow(/EMAIL_FROM_ADDRESS/)

    expect(() =>
      resolveSmtpConfig(
        { ...CUSTOM_SMTP_ENV, SMTP_HOST: 'smtps://smtp.example.test' },
        {},
      ),
    ).toThrow(/SMTP_HOST/)
  })

  it('rejects an unsafe APP_BASE_URL', () => {
    expect(() =>
      resolveSmtpConfig(
        { ...GMAIL_ENV, APP_BASE_URL: 'javascript:alert(1)' },
        {},
      ),
    ).toThrow(EmailConfigError)
  })
})
