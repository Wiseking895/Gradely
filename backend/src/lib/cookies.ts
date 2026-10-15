export const SESSION_COOKIE_NAME = 'gradely_session'

/**
 * Parses a session token out of a raw `Cookie` request header without
 * pulling in a cookie-parsing dependency. Returns null when the cookie is
 * absent or malformed. Only the named session cookie is ever read.
 */
export function readSessionCookie(
  cookieHeader: string | undefined,
  name: string = SESSION_COOKIE_NAME,
): string | null {
  if (!cookieHeader) {
    return null
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) {
      continue
    }
    const key = part.slice(0, separator).trim()
    if (key !== name) {
      continue
    }
    const value = part.slice(separator + 1).trim()
    if (!value) {
      return null
    }
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }

  return null
}
