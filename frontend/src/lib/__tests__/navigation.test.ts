import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTHENTICATED_PATH,
  isUuid,
  loginPathFor,
  safeReturnTo,
} from '../navigation.ts'

describe('safeReturnTo', () => {
  it('accepts same-origin absolute paths and preserves search and hash', () => {
    expect(safeReturnTo('/dashboard/schools/abc?tab=classes#top')).toBe(
      '/dashboard/schools/abc?tab=classes#top',
    )
  })

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
    'dashboard',
    '',
  ])('rejects unsafe return target %s', (value) => {
    expect(safeReturnTo(value)).toBeNull()
  })

  it('falls back to the dashboard for a missing value', () => {
    expect(safeReturnTo(null)).toBeNull()
    expect(DEFAULT_AUTHENTICATED_PATH).toBe('/dashboard')
  })
})

describe('loginPathFor', () => {
  it('encodes a safe return path', () => {
    expect(loginPathFor('/dashboard/schools/abc?tab=classes')).toBe(
      '/login?returnTo=%2Fdashboard%2Fschools%2Fabc%3Ftab%3Dclasses',
    )
  })

  it('does not loop when the requested path is the login page', () => {
    expect(loginPathFor('/login')).toBe('/login')
    expect(loginPathFor('/login?returnTo=%2Fdashboard')).toBe('/login')
  })
})

describe('isUuid', () => {
  it('accepts a canonical UUID and rejects arbitrary strings', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})
