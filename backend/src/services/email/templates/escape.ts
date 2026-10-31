/**
 * Escaping helpers for email templates.
 *
 * Untrusted values are school names, inviter names, and recipient addresses;
 * they can contain HTML metacharacters or CR/LF (header injection). These
 * helpers are the only supported way to interpolate them.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes text for HTML element content and quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  )
}

/**
 * Neutralises a value used in a mail header or a single-line sentence:
 * removes control characters (including CR/LF), collapses whitespace, and
 * trims. Header injection becomes impossible without rejecting legitimate
 * names that happen to contain extra spaces.
 */
export function sanitizeHeaderValue(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
