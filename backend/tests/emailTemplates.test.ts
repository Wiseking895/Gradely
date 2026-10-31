import { describe, expect, it } from 'vitest'
import {
  buildAdminVerificationEmail,
  buildAppLink,
  buildResendVerificationEmail,
  buildTeacherInvitationEmail,
  escapeHtml,
  renderEmailLayout,
  sanitizeHeaderValue,
} from '../src/services/email.ts'

const APP_BASE_URL = 'https://gradely-frontend.vercel.app'
const TOKEN = 'token+/=with-specials'

function assertSingleLine(value: string) {
  expect(value).not.toContain('\r')
  expect(value).not.toContain('\n')
}

describe('escapeHtml', () => {
  it('escapes every HTML metacharacter', () => {
    expect(escapeHtml(`<script>alert("x & y'")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x &amp; y&#39;&quot;)&lt;/script&gt;',
    )
  })
})

describe('sanitizeHeaderValue', () => {
  it('strips CR/LF and collapses whitespace', () => {
    expect(sanitizeHeaderValue('  Springfield\r\nHigh\t School  ')).toBe(
      'Springfield High School',
    )
  })
})

describe('buildAppLink', () => {
  it('encodes token values and keeps the configured origin', () => {
    const link = buildAppLink(`${APP_BASE_URL}/`, '/verify-email', {
      token: TOKEN,
    })

    expect(link.startsWith(`${APP_BASE_URL}/verify-email?`)).toBe(true)
    expect(new URL(link).searchParams.get('token')).toBe(TOKEN)
  })

  it('rejects an unsafe base URL', () => {
    expect(() =>
      buildAppLink('javascript:alert(1)', '/verify-email', { token: 'x' }),
    ).toThrow()
  })

  it.each(['verify-email', '//evil.test/path', '/verify-email?x=1', '/a#b'])(
    'rejects an unsafe link path %s',
    (path) => {
      expect(() => buildAppLink(APP_BASE_URL, path)).toThrow()
    },
  )
})

describe('administrator verification email', () => {
  it('renders subject, plain text, HTML, and an encoded link', () => {
    const message = buildAdminVerificationEmail({
      to: 'admin@springfield.test',
      schoolName: 'Springfield High',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.to).toBe('admin@springfield.test')
    expect(message.subject).toContain('Springfield High')
    expect(message.text).toContain('Welcome to Gradely')
    expect(message.text).toContain('expires in 24 hours')
    expect(message.text).toContain(`${APP_BASE_URL}/verify-email?token=`)
    expect(message.text).not.toContain('<p')
    expect(message.html).toContain('Verify my email')
    expect(message.html).toContain(`${APP_BASE_URL}/verify-email?token=`)
    assertSingleLine(message.subject)
  })

  it('escapes untrusted school names in HTML and subjects', () => {
    const message = buildAdminVerificationEmail({
      to: 'admin@springfield.test',
      schoolName: 'Evil <script>alert("x")</script> School\r\nBcc: bad@example.test',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
    assertSingleLine(message.subject)
  })

  it('honours a custom expiry', () => {
    const message = buildAdminVerificationEmail({
      to: 'admin@springfield.test',
      schoolName: 'Springfield High',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
      expiresInHours: 1,
    })

    expect(message.text).toContain('expires in 1 hours')
  })
})

describe('resend verification email', () => {
  it('states that the previous link no longer works', () => {
    const message = buildResendVerificationEmail({
      to: 'admin@springfield.test',
      schoolName: 'Springfield High',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.subject).toBe('Your new Gradely verification link')
    expect(message.text).toContain('We replaced your previous verification link')
    expect(message.text).toContain('Only the newest link works')
    expect(message.text).toContain('Springfield High')
    expect(message.html).toContain("Here&#39;s your new link")
  })

  it('works without a school name', () => {
    const message = buildResendVerificationEmail({
      to: 'admin@springfield.test',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.text).toContain(
      'activate your school administrator account',
    )
  })
})

describe('teacher invitation email', () => {
  it('renders inviter, school, expiry, and acceptance link', () => {
    const message = buildTeacherInvitationEmail({
      to: 'teacher@springfield.test',
      schoolName: 'Springfield High',
      inviterName: 'Ada Admin',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.subject).toBe(
      'Ada Admin invited you to Springfield High on Gradely',
    )
    expect(message.text).toContain('Ada Admin invited you to join Springfield High')
    expect(message.text).toContain('expires in 7 days')
    expect(message.text).toContain(`${APP_BASE_URL}/accept-invitation?token=`)
    expect(message.html).toContain('Accept invitation')
  })

  it('escapes inviter and school names', () => {
    const message = buildTeacherInvitationEmail({
      to: 'teacher@springfield.test',
      schoolName: 'School <b>One</b>',
      inviterName: 'Mallory & Co',
      appBaseUrl: APP_BASE_URL,
      token: TOKEN,
    })

    expect(message.html).not.toContain('<b>One</b>')
    expect(message.html).toContain('School &lt;b&gt;One&lt;/b&gt;')
    expect(message.html).toContain('Mallory &amp; Co')
  })
})

describe('shared layout', () => {
  it('escapes every interpolated field', () => {
    const { html, text } = renderEmailLayout({
      previewText: '<img src=x onerror=alert(1)>',
      heading: 'Hi <b>there</b>',
      paragraphs: ['Body & "quotes"'],
      actionLabel: 'Go',
      actionUrl: `${APP_BASE_URL}/verify-email?token=${encodeURIComponent(TOKEN)}`,
      expiryNote: 'Expires <soon>',
      footerNote: 'Footer & more',
    })

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>there</b>')
    expect(html).toContain('&lt;b&gt;there&lt;/b&gt;')
    expect(html).toContain('Body &amp; &quot;quotes&quot;')
    expect(text).toContain('Hi <b>there</b>')
    expect(text).toContain('Body & "quotes"')
  })
})
