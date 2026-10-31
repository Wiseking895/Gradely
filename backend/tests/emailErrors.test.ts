import { describe, expect, it } from 'vitest'
import {
  classifySmtpError,
  EmailDeliveryError,
} from '../src/services/email.ts'

describe('EmailDeliveryError', () => {
  it('defaults to a permanent, non-retryable failure', () => {
    const error = new EmailDeliveryError('Delivery failed')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('EmailDeliveryError')
    expect(error.kind).toBe('permanent')
    expect(error.retryable).toBe(false)
    expect(error.providerCode).toBeUndefined()
    expect(error.retryAfterSeconds).toBeUndefined()
  })

  it('marks transient failures as retryable', () => {
    const error = new EmailDeliveryError('Temporary failure', {
      kind: 'transient',
    })

    expect(error.kind).toBe('transient')
    expect(error.retryable).toBe(true)
  })
})

describe('classifySmtpError', () => {
  it('passes an existing delivery error through unchanged', () => {
    const original = new EmailDeliveryError('Already typed', {
      kind: 'config',
    })

    expect(classifySmtpError(original)).toBe(original)
  })

  it('maps authentication failures to a non-retryable config error', () => {
    const error = classifySmtpError(
      Object.assign(new Error('535 auth failed for user and password'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    )

    expect(error.kind).toBe('config')
    expect(error.retryable).toBe(false)
    expect(error.providerCode).toBe('EAUTH')
    expect(error.message).not.toContain('password')
  })

  it('maps a bare 535 response to a config error', () => {
    const error = classifySmtpError({ responseCode: 535 })

    expect(error.kind).toBe('config')
    expect(error.providerCode).toBe('535')
  })

  it.each([
    ['ECONNECTION'],
    ['ETIMEDOUT'],
    ['ESOCKET'],
    ['ECONNRESET'],
    ['EDNS'],
  ])('maps %s to a retryable transient error', (code) => {
    const error = classifySmtpError({ code })

    expect(error.kind).toBe('transient')
    expect(error.retryable).toBe(true)
    expect(error.providerCode).toBe(code)
  })

  it('maps SMTP 4xx throttling to transient and carries Retry-After', () => {
    const error = classifySmtpError({ responseCode: 421, retryAfter: 90.2 })

    expect(error.kind).toBe('transient')
    expect(error.retryAfterSeconds).toBe(91)
  })

  it.each([[550], [551], [552], [553], [554]])(
    'maps SMTP %i to a permanent error',
    (responseCode) => {
      const error = classifySmtpError({ responseCode })

      expect(error.kind).toBe('permanent')
      expect(error.retryable).toBe(false)
    },
  )

  it.each(['EENVELOPE', 'EMESSAGE'])(
    'maps %s to a permanent error',
    (code) => {
      const error = classifySmtpError({ code })

      expect(error.kind).toBe('permanent')
      expect(error.providerCode).toBe(code)
    },
  )

  it('defaults unknown failures to permanent without leaking the raw error', () => {
    const secret = 'super-secret-app-password'
    const error = classifySmtpError(
      new Error(`Unexpected failure while authenticating with ${secret}`),
    )

    expect(error.kind).toBe('permanent')
    expect(error.retryable).toBe(false)
    expect(error.message).not.toContain(secret)
  })

  it('ignores unsafe provider codes instead of copying them into logs', () => {
    const error = classifySmtpError({
      code: 'EVIL code with spaces and token=abc',
    })

    expect(error.providerCode).toBeUndefined()
  })
})
