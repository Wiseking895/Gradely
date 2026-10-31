import { EmailConfigError, normalizeAppBaseUrl } from '../../../config/email.ts'

const LINK_PATH_PATTERN = /^\/[^#?]*$/

/**
 * Builds an absolute frontend link for an email.
 *
 * The base URL is re-validated here (never trust a caller), the path must be a
 * single absolute path, and query values are encoded by `URLSearchParams` so a
 * raw token can never break out of the query string.
 */
export function buildAppLink(
  baseUrl: string,
  path: string,
  query: Record<string, string> = {},
): string {
  const base = normalizeAppBaseUrl(baseUrl)

  if (!LINK_PATH_PATTERN.test(path) || path.startsWith('//')) {
    throw new EmailConfigError(
      'Email link paths must start with a single "/" and contain no query or fragment',
    )
  }

  const url = new URL(`${base}${path}`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}
