import type { SendMailOptions, SentMessageInfo, Transporter } from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'
import type { SmtpConfig } from '../src/config/email.ts'
import {
  buildSmtpMailOptions,
  buildSmtpTransportOptions,
  createEmailService,
  createSmtpEmailService,
  EmailDeliveryError,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from '../src/services/email.ts'

const CONFIG: SmtpConfig = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: 'gradely.test@gmail.com', pass: 'abcdefghijklmnop' },
  fromName: 'Gradely',
  fromAddress: 'gradely.test@gmail.com',
  appBaseUrl: 'https://gradely-frontend.vercel.app',
}

const MESSAGE = {
  to: 'user@school.test',
  subject: 'Verify your email for Gradely',
  text: 'Click https://gradely-frontend.vercel.app/verify-email?token=RAW-TOKEN-VALUE',
  html: '<p>Click <a href="https://gradely-frontend.vercel.app/verify-email?token=RAW-TOKEN-VALUE">here</a></p>',
}

function createFakeTransport(overrides?: Partial<SentMessageInfo>) {
  const sendMail = vi.fn(
    async (_mail: SendMailOptions): Promise<SentMessageInfo> =>
      ({
        envelope: { from: CONFIG.fromAddress, to: [MESSAGE.to] },
        messageId: '<message-1@gradely.test>',
        accepted: [MESSAGE.to],
        rejected: [],
        ...overrides,
      }) as SentMessageInfo,
  )

  return {
    sendMail,
    transporter: { sendMail } as unknown as Transporter,
  }
}

describe('buildSmtpTransportOptions', () => {
  it('enables implicit TLS, bounded timeouts, and safe defaults', () => {
    const options = buildSmtpTransportOptions(CONFIG)

    expect(options).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: CONFIG.auth,
      pool: false,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    })
  })

  it('requires STARTTLS when implicit TLS is disabled', () => {
    const options = buildSmtpTransportOptions({
      ...CONFIG,
      port: 587,
      secure: false,
    })

    expect(options.secure).toBe(false)
    expect(options.requireTLS).toBe(true)
  })

  it('omits auth for an unauthenticated local relay', () => {
    const options = buildSmtpTransportOptions({ ...CONFIG, auth: null })

    expect(options.auth).toBeUndefined()
  })
})

describe('buildSmtpMailOptions', () => {
  it('builds a validated message with an explicit envelope', () => {
    const mail = buildSmtpMailOptions(CONFIG, MESSAGE)

    expect(mail).toMatchObject({
      from: { name: 'Gradely', address: 'gradely.test@gmail.com' },
      to: 'user@school.test',
      subject: 'Verify your email for Gradely',
      text: MESSAGE.text,
      html: MESSAGE.html,
      envelope: { from: 'gradely.test@gmail.com', to: ['user@school.test'] },
      headers: { 'X-Auto-Response-Suppress': 'All' },
    })
  })

  it('omits the HTML alternative when only text is supplied', () => {
    const mail = buildSmtpMailOptions(CONFIG, {
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    })

    expect('html' in mail).toBe(false)
  })

  it('rejects header injection and invalid recipients', () => {
    expect(() =>
      buildSmtpMailOptions(CONFIG, {
        ...MESSAGE,
        subject: 'Hello\r\nBcc: evil@example.test',
      }),
    ).toThrow(EmailDeliveryError)

    expect(() =>
      buildSmtpMailOptions(CONFIG, { ...MESSAGE, to: 'not-an-address' }),
    ).toThrow(/Recipient address/)
  })
})

describe('createSmtpEmailService', () => {
  it('creates the transporter lazily and reuses it across sends', async () => {
    const fake = createFakeTransport()
    const factory = vi.fn(() => fake.transporter)
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: factory,
      logger: { log: vi.fn() },
    })

    expect(factory).not.toHaveBeenCalled()

    await service.send(MESSAGE)
    await service.send(MESSAGE)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(fake.sendMail).toHaveBeenCalledTimes(2)
  })

  it('passes the composed message to the transporter', async () => {
    const fake = createFakeTransport()
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: () => fake.transporter,
      logger: { log: vi.fn() },
    })

    await service.send(MESSAGE)

    const mail = fake.sendMail.mock.calls[0]?.[0]
    expect(mail).toMatchObject({
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    })
  })

  it('logs only the provider message ID, never tokens or credentials', async () => {
    const fake = createFakeTransport()
    const logger = { log: vi.fn() }
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: () => fake.transporter,
      logger,
    })

    await service.send(MESSAGE)

    const logged = logger.log.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('messageId')
    expect(logged).not.toContain('RAW-TOKEN-VALUE')
    expect(logged).not.toContain(MESSAGE.to)
    expect(logged).not.toContain(CONFIG.auth?.pass ?? '')
    expect(logged).not.toContain(MESSAGE.subject)
  })

  it('does not construct a transporter for an invalid message', async () => {
    const factory = vi.fn(() => createFakeTransport().transporter)
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: factory,
      logger: { log: vi.fn() },
    })

    await expect(
      service.send({ ...MESSAGE, to: 'invalid' }),
    ).rejects.toMatchObject({ kind: 'permanent', providerCode: 'EENVELOPE' })
    expect(factory).not.toHaveBeenCalled()
  })

  it('maps provider authentication failures to a config error', async () => {
    const fake = createFakeTransport()
    fake.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('EAUTH with password abcdefghijklmnop'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    )
    const logger = { log: vi.fn() }
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: () => fake.transporter,
      logger,
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      kind: 'config',
      retryable: false,
      providerCode: 'EAUTH',
    })

    // Phase 1 does not retry; classification is exposed for Phase 2.
    expect(fake.sendMail).toHaveBeenCalledTimes(1)
    expect(logger.log).not.toHaveBeenCalled()
  })

  it('maps transient network failures without retrying in Phase 1', async () => {
    const fake = createFakeTransport()
    fake.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }),
    )
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: () => fake.transporter,
      logger: { log: vi.fn() },
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      kind: 'transient',
      retryable: true,
      providerCode: 'ETIMEDOUT',
    })
    expect(fake.sendMail).toHaveBeenCalledTimes(1)
  })

  it('treats a fully rejected recipient list as a permanent failure', async () => {
    const fake = createFakeTransport({
      accepted: [],
      rejected: [MESSAGE.to],
    })
    const logger = { log: vi.fn() }
    const service = createSmtpEmailService(CONFIG, {
      transporterFactory: () => fake.transporter,
      logger,
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      kind: 'permanent',
      providerCode: 'EENVELOPE',
    })
    expect(logger.log).not.toHaveBeenCalled()
  })
})

describe('createEmailService smtp selection', () => {
  it('creates the SMTP adapter for a configured resolution', async () => {
    const fake = createFakeTransport()
    const logger = { log: vi.fn(), error: vi.fn() }
    const service = createEmailService('smtp', {
      smtp: { status: 'configured', config: CONFIG },
      smtpTransporterFactory: () => fake.transporter,
      logger,
    })

    await service.send(MESSAGE)

    expect(fake.sendMail).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('degrades to an honest unavailable transport when configuration is incomplete', async () => {
    const logger = { log: vi.fn(), error: vi.fn() }
    const service = createEmailService('smtp', {
      smtp: {
        status: 'incomplete',
        missing: ['SMTP_USER', 'SMTP_APP_PASSWORD'],
      },
      logger,
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      kind: 'config',
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    const logged = logger.error.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('SMTP_USER')
    expect(logged).not.toContain('RAW-TOKEN-VALUE')
    expect(logged).not.toContain('abcdefghijklmnop')
  })

  it('degrades when smtp is selected without any resolved configuration', async () => {
    const service = createEmailService('smtp', {
      logger: { log: vi.fn(), error: vi.fn() },
    })

    await expect(service.send(MESSAGE)).rejects.toMatchObject({
      kind: 'config',
    })
  })
})
