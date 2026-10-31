import { escapeHtml } from './escape.ts'

/**
 * Shared, dependency-free HTML + plain-text layout for transactional email.
 *
 * Constraints chosen for real mail clients:
 *   - table-based structure with inline CSS only (Gmail strips <style> in some
 *     contexts);
 *   - no external images, tracking pixels, or remote CSS;
 *   - a bulletproof button plus a visible fallback URL;
 *   - every interpolated value escaped in HTML and kept in the text part.
 */

export type EmailLayoutInput = {
  previewText: string
  heading: string
  paragraphs: readonly string[]
  actionLabel: string
  actionUrl: string
  expiryNote: string
  footerNote: string
}

export type RenderedEmailBodies = {
  html: string
  text: string
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const BRAND_NAVY = '#174a9c'
const BRAND_BLUE = '#0785ef'
const BRAND_INK = '#172033'
const BRAND_MUTED = '#64748b'
const BRAND_SURFACE = '#f7f9fc'
const BRAND_BORDER = '#e2e8f0'

export function renderEmailLayout(
  input: EmailLayoutInput,
): RenderedEmailBodies {
  const paragraphsHtml = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND_INK};">${escapeHtml(paragraph)}</p>`,
    )
    .join('')

  const escapedUrl = escapeHtml(input.actionUrl)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_SURFACE};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND_SURFACE};padding:24px 12px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;padding:32px;font-family:${FONT_STACK};">
<tr>
<td style="padding:0 0 24px;font-size:20px;font-weight:700;color:${BRAND_NAVY};">Gradely</td>
</tr>
<tr>
<td style="padding:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${BRAND_INK};">${escapeHtml(input.heading)}</td>
</tr>
<tr>
<td>${paragraphsHtml}</td>
</tr>
<tr>
<td style="padding:8px 0 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${BRAND_NAVY}" style="border-radius:8px;">
<a href="${escapedUrl}" style="display:inline-block;padding:14px 24px;font-family:${FONT_STACK};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(input.actionLabel)}</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:0 0 6px;font-size:14px;color:${BRAND_MUTED};">If the button does not work, copy this link into your browser:</td>
</tr>
<tr>
<td style="padding:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;">
<a href="${escapedUrl}" style="color:${BRAND_BLUE};text-decoration:underline;">${escapedUrl}</a>
</td>
</tr>
<tr>
<td style="padding:0 0 12px;font-size:16px;line-height:1.6;color:${BRAND_INK};">${escapeHtml(input.expiryNote)}</td>
</tr>
<tr>
<td style="padding:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND_MUTED};">${escapeHtml(input.footerNote)}</td>
</tr>
<tr>
<td style="padding:24px 0 0;border-top:1px solid ${BRAND_BORDER};font-size:13px;color:${BRAND_MUTED};">Gradely &middot; school operations</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  const text = [
    input.heading,
    '',
    ...input.paragraphs,
    '',
    `${input.actionLabel}:`,
    input.actionUrl,
    '',
    input.expiryNote,
    '',
    input.footerNote,
    '',
    'Gradely - school operations',
  ].join('\n')

  return { html, text }
}
