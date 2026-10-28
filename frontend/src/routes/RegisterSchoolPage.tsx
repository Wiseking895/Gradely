import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, CheckCircle2, School, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'
import ResendVerificationForm from '../components/ResendVerificationForm.tsx'
import { ApiError, authApi } from '../lib/api.ts'
import { isNetworkError } from '../lib/authContext.ts'

/**
 * Public self-service school registration (Phase A).
 *
 * Creates the school + founding administrator and emails a single-use
 * verification link. The school and the administrator's membership stay
 * pending until that link is redeemed, so unverified accounts cannot use
 * protected school features.
 */

const inputClasses =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

const labelClasses = 'mb-1.5 block text-sm font-medium text-brand-ink'

const slugPattern = /^[a-z0-9][a-z0-9-]{1,62}$/

type FieldErrors = {
  schoolName?: string
  schoolSlug?: string
  adminName?: string
  email?: string
  password?: string
  confirmPassword?: string
  form?: string
}

type Phase =
  | { kind: 'form' }
  | { kind: 'sent'; email: string }
  | { kind: 'delivery_failed'; email: string }

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
}

function validate(values: {
  schoolName: string
  schoolSlug: string
  adminName: string
  email: string
  password: string
  confirmPassword: string
}): FieldErrors {
  const errors: FieldErrors = {}

  const schoolName = values.schoolName.trim()
  if (schoolName.length < 2 || schoolName.length > 120) {
    errors.schoolName = 'School name must be 2–120 characters.'
  }

  const schoolSlug = values.schoolSlug.trim().toLowerCase()
  if (!slugPattern.test(schoolSlug)) {
    errors.schoolSlug =
      'Use 2–63 lowercase letters, numbers or hyphens, starting with a letter or number.'
  }

  if (!values.adminName.trim()) {
    errors.adminName = 'Your name is required.'
  } else if (values.adminName.trim().length > 120) {
    errors.adminName = 'Your name must be 120 characters or fewer.'
  }

  if (!values.email.trim()) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (values.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.'
  }
  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  return errors
}

export default function RegisterSchoolPage() {
  const [schoolName, setSchoolName] = useState('')
  const [schoolSlug, setSchoolSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [adminName, setAdminName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const values = {
      schoolName,
      schoolSlug,
      adminName,
      email,
      password,
      confirmPassword,
    }
    const clientErrors = validate(values)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length > 0) {
      return
    }

    setSubmitting(true)
    setErrors({})
    try {
      await authApi.registerSchool({
        schoolName: schoolName.trim(),
        schoolSlug: schoolSlug.trim().toLowerCase(),
        adminName: adminName.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
      setPhase({ kind: 'sent', email: email.trim().toLowerCase() })
    } catch (error) {
      if (error instanceof ApiError) {
        const details = error.details as { code?: string } | undefined
        if (details?.code === 'email_taken') {
          setErrors({
            email:
              'An account with this email already exists. Sign in instead, or use a different email.',
          })
        } else if (details?.code === 'school_identifier_taken') {
          setErrors({
            schoolSlug: 'That school identifier is taken. Please choose another one.',
          })
        } else if (details?.code === 'email_delivery_failed') {
          setPhase({ kind: 'delivery_failed', email: email.trim().toLowerCase() })
        } else if (error.status === 429) {
          setErrors({
            form: 'Too many attempts. Please wait a few minutes and try again.',
          })
        } else if (error.status === 0 || isNetworkError(error)) {
          setErrors({
            form: 'Could not reach the server. Check your connection and try again.',
          })
        } else {
          setErrors({
            form: error.message || 'Registration failed. Please try again.',
          })
        }
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (phase.kind === 'sent') {
    return (
      <PageShell>
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
            Check your email
          </h1>
          <p className="mt-2 text-sm leading-6 text-brand-muted">
            We sent a verification link to{' '}
            <span className="font-medium text-brand-ink">{phase.email}</span>.
            Open it to activate your school administrator account. The link
            expires in 24 hours and can be used once.
          </p>
          <p className="mt-3 text-sm leading-6 text-brand-muted">
            Didn&apos;t get it? Check your spam folder or request a new link
            below.
          </p>
        </div>
        <ResendVerificationForm defaultEmail={phase.email} />
        <p className="mt-6 text-center text-sm">
          <Link
            to="/login"
            className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            Back to sign in
          </Link>
        </p>
      </PageShell>
    )
  }

  if (phase.kind === 'delivery_failed') {
    return (
      <PageShell>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-brand-navy">
            Verification email not sent
          </h1>
          <p className="mt-2 text-sm leading-6 text-brand-muted">
            Your school and administrator account were created, but we could
            not send the verification email. Request a new link below.
          </p>
        </div>
        <ResendVerificationForm defaultEmail={phase.email} />
        <p className="mt-6 text-center text-sm">
          <Link
            to="/login"
            className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            Back to sign in
          </Link>
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex flex-col items-center text-center">
        <BrandMark />
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-brand-navy">
          Register your school
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-brand-muted">
          Create the school administrator account. You&apos;ll verify your
          email before your school is activated.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        {errors.form && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700"
          >
            {errors.form}
          </p>
        )}

        <fieldset className="mb-6 min-w-0">
          <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <School className="h-4 w-4 text-brand-blue" aria-hidden="true" />
            School details
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="schoolName" className={labelClasses}>
                School name
              </label>
              <input
                id="schoolName"
                name="schoolName"
                required
                value={schoolName}
                onChange={(event) => {
                  const value = event.target.value
                  setSchoolName(value)
                  if (!slugEdited) {
                    setSchoolSlug(slugify(value))
                  }
                }}
                aria-invalid={errors.schoolName ? true : undefined}
                aria-describedby={
                  errors.schoolName ? 'schoolName-error' : undefined
                }
                className={inputClasses}
                placeholder="Bright Future Academy"
                autoComplete="organization"
              />
              {errors.schoolName && (
                <p id="schoolName-error" className="mt-1.5 text-sm text-red-700">
                  {errors.schoolName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="schoolSlug" className={labelClasses}>
                School identifier
              </label>
              <input
                id="schoolSlug"
                name="schoolSlug"
                required
                value={schoolSlug}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSchoolSlug(event.target.value.toLowerCase())
                }}
                aria-invalid={errors.schoolSlug ? true : undefined}
                aria-describedby={`schoolSlug-help${
                  errors.schoolSlug ? ' schoolSlug-error' : ''
                }`}
                className={inputClasses}
                placeholder="bright-future-academy"
                autoComplete="off"
                spellCheck={false}
              />
              {errors.schoolSlug ? (
                <p id="schoolSlug-error" className="mt-1.5 text-sm text-red-700">
                  {errors.schoolSlug}
                </p>
              ) : (
                <p id="schoolSlug-help" className="mt-1.5 text-xs text-brand-muted">
                  Lowercase letters, numbers and hyphens. Used in school links.
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <UserRound className="h-4 w-4 text-brand-blue" aria-hidden="true" />
            Administrator account
          </legend>

          <div className="mb-4">
            <label htmlFor="adminName" className={labelClasses}>
              Your full name
            </label>
            <input
              id="adminName"
              name="adminName"
              required
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              aria-invalid={errors.adminName ? true : undefined}
              aria-describedby={errors.adminName ? 'adminName-error' : undefined}
              className={inputClasses}
              placeholder="Ada Admin"
              autoComplete="name"
            />
            {errors.adminName && (
              <p id="adminName-error" className="mt-1.5 text-sm text-red-700">
                {errors.adminName}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="email" className={labelClasses}>
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className={inputClasses}
              placeholder="you@school.edu"
              autoComplete="username"
            />
            {errors.email && (
              <p id="email-error" className="mt-1.5 text-sm text-red-700">
                {errors.email}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="password" className={labelClasses}>
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby="password-help"
                className={inputClasses}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <p id="password-help" className="mt-1.5 text-xs text-brand-muted">
                Use at least 8 characters.
              </p>
              {errors.password && (
                <p className="mt-1.5 text-sm text-red-700">{errors.password}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className={labelClasses}>
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={
                  errors.confirmPassword ? 'confirmPassword-error' : undefined
                }
                className={inputClasses}
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />
              {errors.confirmPassword && (
                <p
                  id="confirmPassword-error"
                  className="mt-1.5 text-sm text-red-700"
                >
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          {submitting ? 'Creating school…' : 'Create school account'}
        </button>

        <p className="mt-4 text-center text-sm text-brand-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            Sign in
          </Link>
        </p>
      </form>
    </PageShell>
  )
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-surface px-4 py-10">
      <main className="w-full min-w-0 max-w-xl">{children}</main>
      <p className="mt-6 text-center text-sm">
        <Link
          to="/"
          className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          Back to home
        </Link>
      </p>
    </div>
  )
}
