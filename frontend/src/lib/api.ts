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
      const body = (await response.json()) as {
        error?: string
        message?: string
        code?: string
      }
      return new ApiError(
        // The backend uses a generic `error` label for 4xx responses and the
        // specific, user-safe explanation in `message`.
        body.message ?? body.error ?? `Request failed (${response.status})`,
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

/* --- School management API ---------------------------------------------- */

export type ManagementStatus = 'active' | 'archived'

export type ClassLevel = {
  code: string
  label: string
  sortOrder: number
}

export type SchoolLogo = {
  url: string | null
  updatedAt: string | null
  storageAvailable: boolean
}

export type SchoolProfile = {
  id: string
  name: string
  slug: string
  status: string
  contactEmail: string | null
  phone: string | null
  address: string | null
  logo: SchoolLogo
  profileCompletedAt: string | null
  setupCompletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SetupSteps = {
  profile: boolean
  classes: boolean
  subjects: boolean
  assignments: boolean
}

export type SchoolOverview = {
  role: SchoolRole | 'platform_admin'
  canManage: boolean
  school: SchoolProfile
  setup: {
    complete: boolean
    completedAt: string | null
    steps: SetupSteps
    optional: { logo: boolean }
    counts: {
      classes: number
      sections: number
      subjects: number
      assignments: number
      archivedClasses: number
      archivedSubjects: number
    }
  }
}

export type SchoolSection = {
  id: string
  classId: string
  name: string
  status: ManagementStatus
  createdAt: string
  updatedAt: string
}

export type SchoolClassSummary = {
  id: string
  level: ClassLevel
  status: ManagementStatus
  activeSubjectCount: number
  archivedSubjectCount: number
  createdAt: string
  updatedAt: string
}

export type SchoolClass = SchoolClassSummary & {
  sections: SchoolSection[]
}

export type Subject = {
  id: string
  name: string
  status: ManagementStatus
  activeAssignmentCount: number
  createdAt: string
  updatedAt: string
}

export type Assignment = {
  id: string
  subject: {
    id: string
    name: string
    status: ManagementStatus
  }
  status: ManagementStatus
  createdAt: string
  updatedAt: string
}

export type ClassDetail = {
  class: SchoolClassSummary
  sections: SchoolSection[]
  assignments: Assignment[]
}

export type UpdateSchoolProfileInput = {
  name?: string
  contactEmail?: string | null
  phone?: string | null
  address?: string | null
}

export type LogoUploadTicket = {
  uploadId: string
  uploadUrl: string
  expiresAt: string
  contentType: string
  maxSizeBytes: number
}

function schoolPath(schoolId: string, suffix = ''): string {
  return `/api/schools/${encodeURIComponent(schoolId)}${suffix}`
}

export const schoolsApi = {
  overview: (schoolId: string) =>
    apiFetch<SchoolOverview>(schoolPath(schoolId, '/overview')),

  classLevels: (schoolId: string) =>
    apiFetch<{ levels: ClassLevel[] }>(schoolPath(schoolId, '/class-levels')),

  classes: (schoolId: string) =>
    apiFetch<{ classes: SchoolClass[] }>(schoolPath(schoolId, '/classes')),

  classDetail: (schoolId: string, classId: string) =>
    apiFetch<ClassDetail>(
      schoolPath(
        schoolId,
        `/classes/${encodeURIComponent(classId)}`,
      ),
    ),

  subjects: (schoolId: string) =>
    apiFetch<{ subjects: Subject[] }>(schoolPath(schoolId, '/subjects')),

  updateProfile: (schoolId: string, input: UpdateSchoolProfileInput) =>
    apiFetch<{ school: SchoolProfile }>(schoolPath(schoolId, '/profile'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  createClass: (schoolId: string, levelCode: string) =>
    apiFetch<{ class: SchoolClassSummary }>(schoolPath(schoolId, '/classes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelCode }),
    }),

  updateClassStatus: (
    schoolId: string,
    classId: string,
    status: ManagementStatus,
  ) =>
    apiFetch<{ class: SchoolClassSummary }>(
      schoolPath(schoolId, `/classes/${encodeURIComponent(classId)}`),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    ),

  createSection: (schoolId: string, classId: string, name: string) =>
    apiFetch<{ section: SchoolSection }>(
      schoolPath(
        schoolId,
        `/classes/${encodeURIComponent(classId)}/sections`,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    ),

  updateSection: (
    schoolId: string,
    classId: string,
    sectionId: string,
    input: { name?: string; status?: ManagementStatus },
  ) =>
    apiFetch<{ section: SchoolSection }>(
      schoolPath(
        schoolId,
        `/classes/${encodeURIComponent(classId)}/sections/${encodeURIComponent(sectionId)}`,
      ),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),

  createSubject: (schoolId: string, name: string) =>
    apiFetch<{ subject: Subject }>(schoolPath(schoolId, '/subjects'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  updateSubject: (
    schoolId: string,
    subjectId: string,
    input: { name?: string; status?: ManagementStatus },
  ) =>
    apiFetch<{ subject: Subject }>(
      schoolPath(schoolId, `/subjects/${encodeURIComponent(subjectId)}`),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),

  createAssignment: (schoolId: string, classId: string, subjectId: string) =>
    apiFetch<{ assignment: Assignment }>(
      schoolPath(
        schoolId,
        `/classes/${encodeURIComponent(classId)}/subjects`,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      },
    ),

  updateAssignmentStatus: (
    schoolId: string,
    classId: string,
    subjectId: string,
    status: ManagementStatus,
  ) =>
    apiFetch<{ assignment: Assignment }>(
      schoolPath(
        schoolId,
        `/classes/${encodeURIComponent(classId)}/subjects/${encodeURIComponent(subjectId)}`,
      ),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    ),

  requestLogoUpload: (
    schoolId: string,
    input: { contentType: string; fileSizeBytes: number },
  ) =>
    apiFetch<LogoUploadTicket>(schoolPath(schoolId, '/logo/uploads'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  completeLogoUpload: (
    schoolId: string,
    input: { uploadId: string; contentType: string },
  ) =>
    apiFetch<{ logo: SchoolLogo }>(schoolPath(schoolId, '/logo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  removeLogo: (schoolId: string) =>
    apiFetch<{ logo: SchoolLogo }>(schoolPath(schoolId, '/logo'), {
      method: 'DELETE',
    }),
}
