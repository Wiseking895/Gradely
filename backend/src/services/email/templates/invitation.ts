import type { EmailMessage } from '../types.ts'
import { sanitizeHeaderValue } from './escape.ts'
import { renderEmailLayout } from './layout.ts'
import { buildAppLink } from './links.ts'

const DEFAULT_INVITATION_EXPIRY_DAYS = 7

export type TeacherInvitationEmailInput = {
  to: string
  schoolName: string
  inviterName: string
  appBaseUrl: string
  token: string
  expiresInDays?: number
}

/**
 * Teacher invitation email (Phase 3 feature; rendered here so the template is
 * covered by tests long before the invitation routes exist).
 */
export function buildTeacherInvitationEmail(
  input: TeacherInvitationEmailInput,
): EmailMessage {
  const schoolName = sanitizeHeaderValue(input.schoolName) || 'a school'
  const inviterName =
    sanitizeHeaderValue(input.inviterName) || 'A Gradely administrator'
  const expiresInDays =
    input.expiresInDays ?? DEFAULT_INVITATION_EXPIRY_DAYS
  const link = buildAppLink(input.appBaseUrl, '/accept-invitation', {
    token: input.token,
  })

  const { html, text } = renderEmailLayout({
    previewText: `Join ${schoolName} as a teacher.`,
    heading: "You're invited",
    paragraphs: [
      `${inviterName} invited you to join ${schoolName} as a teacher on Gradely.`,
      'Accept the invitation to connect your account and start collaborating with your school.',
      'If you were not expecting this invitation, you can ignore this email.',
    ],
    actionLabel: 'Accept invitation',
    actionUrl: link,
    expiryNote: `This invitation expires in ${expiresInDays} days and can be used once.`,
    footerNote:
      'You are receiving this email because a school administrator invited this address to Gradely.',
  })

  return {
    to: input.to,
    subject: sanitizeHeaderValue(
      `${inviterName} invited you to ${schoolName} on Gradely`,
    ),
    text,
    html,
  }
}
