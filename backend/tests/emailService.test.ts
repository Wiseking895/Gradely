import { describe, expect, it, vi } from 'vitest'
import {
  createConsoleEmailService,
  createEmailService,
  createMemoryEmailService,
  createUnavailableEmailService,
  EmailDeliveryError,
} from '../src/services/email.ts'

const MESSAGE = {
  to: 'user@school.test',
  subject: 'Verify your email for Gradely',
  text: 'Click http://localhost:5173/verify-email?token=RAW-TOKEN-VALUE',
}

describe('memory email service', () => {
  it('captures messages in an inspectable outbox', async () => {
    const email = createMemoryEmailService()
    await email.send(MESSAGE)
    expect(email.outboxLength()).toBe(1)
    expect(email.lastMessage()?.to).toBe('user@school.test')
    expect(email.messagesFor('user@school.test')).toHaveLength(1)
    expect(email.messagesFor('other@school.test')).toHaveLength(0)
  })

  it('fails the next N sends then recovers', async () => {
    const email = createMemoryEmailService()
    email.failNextSends(1)
    await expect(email.send(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryError)
    await email.send(MESSAGE)
    expect(email.outboxLength()).toBe(1)
  })

  it('fails every send while failAll is enabled', async () => {
    const email = createMemoryEmailService()
    email.failAll()
    await expect(email.send(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryError)
    email.failAll(false)
    await email.send(MESSAGE)
    expect(email.outboxLength()).toBe(1)
  })
})

describe('console email service (log transport)', () => {
  it('prints the body outside production so the link is clickable in dev', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const email = createConsoleEmailService({ includeBodies: true })
      await email.send(MESSAGE)
      const logged = logSpy.mock.calls.flat().map(String).join('\n')
      expect(logged).toContain('user@school.test')
      expect(logged).toContain('token=RAW-TOKEN-VALUE')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('suppresses the body (and thus the token) when includeBodies is false', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const email = createConsoleEmailService({ includeBodies: false })
      await email.send(MESSAGE)
      const logged = logSpy.mock.calls.flat().map(String).join('\n')
      expect(logged).toContain('user@school.test')
      expect(logged).not.toContain('RAW-TOKEN-VALUE')
      expect(logged).not.toContain('token=')
      expect(logged).toContain('body suppressed')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('createEmailService never prints bodies for the production log transport', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const email = createEmailService('log', { isProduction: true })
      await email.send(MESSAGE)
      const logged = logSpy.mock.calls.flat().map(String).join('\n')
      expect(logged).not.toContain('RAW-TOKEN-VALUE')
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('unavailable email service (production default)', () => {
  it('rejects loudly instead of silently dropping mail', async () => {
    const email = createUnavailableEmailService()
    await expect(email.send(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryError)
    const viaFactory = createEmailService('unavailable')
    await expect(viaFactory.send(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryError)
  })
})

describe('createEmailService factory', () => {
  it('selects the memory transport for tests', async () => {
    const email = createEmailService('memory')
    await email.send(MESSAGE)
    // Only the memory service exposes an outbox.
    expect('outboxLength' in email).toBe(true)
  })
})
