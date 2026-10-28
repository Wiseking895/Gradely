/**
 * Frontend API service layer.
 *
 * All backend communication goes through this module. The base URL comes
 * from the VITE_API_URL environment variable (Vercel project settings):
 *  - empty/unset -> same-origin requests (local dev uses the Vite proxy)
 *  - e.g. https://gradely-api.vercel.app in production
 * Localhost is never assumed here.
 */

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export function getApiBaseUrl(): string {
  return API_BASE_URL
}

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      return new ApiError(
        body.error ?? body.message ?? `Request failed (${response.status})`,
        response.status,
        body,
      )
    } catch {
      // Body looked like JSON but was not parseable; fall through.
    }
  }

  return new ApiError(`Request failed (${response.status})`, response.status)
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')

  let response: Response
  try {
    // credentials: 'include' sends the HttpOnly session cookie on
    // cross-origin production requests (the backend CORS allow-list must
    // include this frontend's origin).
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    // Network failure, DNS failure, CORS block, etc.
    throw new ApiError('Could not reach the API server', 0)
  }

  if (!response.ok) {
    throw await toApiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError('API returned an invalid JSON response', response.status)
  }
}

export type HealthStatus = {
  status: string
  service: string
  environment: string
  timestamp: string
  uptimeSeconds: number
  database: string
}

export const healthApi = {
  get: () => apiFetch<HealthStatus>('/api/health'),
}

/* --- Auth API ----------------------------------------------------------- */

export type SessionUser = {
  id: string
  email: string
  displayName: string
  isPlatformAdmin: boolean
  emailVerified: boolean
}

export type SchoolRole = 'school_admin' | 'teacher'

export type MembershipSummary = {
  schoolId: string
  schoolName: string
  schoolSlug: string
  schoolStatus: string
  role: SchoolRole
}

export type LoginResponse = {
  user: SessionUser
  expiresAt: string
}

export type MeResponse = {
  user: SessionUser
  session: { expiresAt: string }
  memberships: MembershipSummary[]
}

export type RegisterSchoolInput = {
  schoolName: string
  schoolSlug: string
  adminName: string
  email: string
  password: string
}

export type RegisterSchoolResponse = {
  status: 'verification_sent'
  user: SessionUser
  school: { id: string; name: string; slug: string }
}

export type VerifyEmailResponse = {
  status: 'verified'
  user: SessionUser
}

export type ResendVerificationResponse = {
  status: 'pending'
  message: string
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    apiFetch<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  me: () => apiFetch<MeResponse>('/api/auth/me'),
  registerSchool: (input: RegisterSchoolInput) =>
    apiFetch<RegisterSchoolResponse>('/api/auth/register-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  verifyEmail: (token: string) =>
    apiFetch<VerifyEmailResponse>('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string) =>
    apiFetch<ResendVerificationResponse>('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
}
