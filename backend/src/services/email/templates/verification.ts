import type { EmailMessage } from '../types.ts'
import { sanitizeHeaderValue } from './escape.ts'
import { renderEmailLayout } from './layout.ts'
import { buildAppLink } from './links.ts'

const DEFAULT_VERIFICATION_EXPIRY_HOURS = 24

export type AdminVerificationEmailInput = {
  to: string
  schoolName: string
  /** Validated frontend origin (env.appBaseUrl). */
  appBaseUrl: string
  token: string
  expiresInHours?: number
}

/**
 * School administrator verification email.
 *
 * The subject includes the school name, so it is sanitised for CR/LF (header
 * injection) before use; the HTML body escapes it separately.
 */
export function buildAdminVerificationEmail(
  input: AdminVerificationEmailInput,
): EmailMessage {
  const schoolName = sanitizeHeaderValue(input.schoolName) || 'your school'
  const expiresInHours =
    input.expiresInHours ?? DEFAULT_VERIFICATION_EXPIRY_HOURS
  const link = buildAppLink(input.appBaseUrl, '/verify-email', {
    token: input.token,
  })

  const { html, text } = renderEmailLayout({
    previewText: 'One click activates your school administrator account.',
    heading: 'Welcome to Gradely',
    paragraphs: [
      `Confirm your email address to activate the school administrator account for ${schoolName}.`,
      'If you did not create this account, you can ignore this email - nothing will happen.',
    ],
    actionLabel: 'Verify my email',
    actionUrl: link,
    expiryNote: `This link expires in ${expiresInHours} hours and can be used once.`,
    footerNote:
      'You are receiving this email because a Gradely school administrator account was created with this address.',
  })

  return {
    to: input.to,
    subject: sanitizeHeaderValue(
      `Verify your email to activate ${schoolName} on Gradely`,
    ),
    text,
    html,
  }
}

export type ResendVerificationEmailInput = {
  to: string
  /** Optional: resend requests only know the email address. */
  schoolName?: string
  appBaseUrl: string
  token: string
  expiresInHours?: number
}

/**
 * Resend verification email. The copy states explicitly that the previous
 * link is no longer valid, matching the "one live token per user" invariant.
 */
export function buildResendVerificationEmail(
  input: ResendVerificationEmailInput,
): EmailMessage {
  const schoolName = input.schoolName
    ? sanitizeHeaderValue(input.schoolName)
    : undefined
  const expiresInHours =
    input.expiresInHours ?? DEFAULT_VERIFICATION_EXPIRY_HOURS
  const link = buildAppLink(input.appBaseUrl, '/verify-email', {
    token: input.token,
  })

  const { html, text } = renderEmailLayout({
    previewText: 'A fresh link replaces the previous one.',
    heading: "Here's your new link",
    paragraphs: [
      'We replaced your previous verification link. Only the newest link works.',
      schoolName
        ? `Confirm your email address to activate the school administrator account for ${schoolName}.`
        : 'Confirm your email address to activate your school administrator account.',
      'If you did not request this email, you can ignore it.',
    ],
    actionLabel: 'Verify my email',
    actionUrl: link,
    expiryNote: `This link expires in ${expiresInHours} hours and can be used once.`,
    footerNote:
      'You are receiving this email because a verification email was requested for this address.',
  })

  return {
    to: input.to,
    subject: sanitizeHeaderValue('Your new Gradely verification link'),
    text,
    html,
  }
}
