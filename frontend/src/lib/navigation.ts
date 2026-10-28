/**
 * Navigation helpers shared by the auth screens and route guards.
 *
 * `returnTo` comes from a URL query string, so it is attacker-controlled. Only
 * same-origin, absolute paths are accepted. Protocol-relative values (`//...`),
 * backslash tricks, and full URLs are rejected, preventing open redirects.
 */

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard'

export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return null
  }

  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function loginPathFor(returnTo: string): string {
  const safe = safeReturnTo(returnTo)
  if (!safe || safe === '/login' || safe.startsWith('/login?')) return '/login'
  return `/login?returnTo=${encodeURIComponent(safe)}`
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
