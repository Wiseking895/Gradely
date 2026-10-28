import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'
import { isNetworkError, useAuth } from '../lib/authContext.ts'
import {
  DEFAULT_AUTHENTICATED_PATH,
  safeReturnTo,
} from '../lib/navigation.ts'

type FormErrors = {
  email?: string
  password?: string
  form?: string
}

function validate(email: string, password: string): FormErrors {
  const errors: FormErrors = {}
  if (!email.trim()) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!password) {
    errors.password = 'Password is required.'
  }
  return errors
}

const inputClasses =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

const labelClasses = 'mb-1.5 block text-sm font-medium text-brand-ink'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const clientErrors = validate(email, password)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length > 0) {
      return
    }

    setSubmitting(true)
    setErrors({})
    try {
      const user = await login(email.trim(), password)
      // Unverified administrators may sign in (so they can see verification
      // state and request a new link) but are sent to the verification screen
      // instead of the app; protected school routes still return 403.
      if (!user.emailVerified) {
        navigate('/verify-email')
        return
      }
      const returnTo = safeReturnTo(searchParams.get('returnTo'))
      navigate(returnTo ?? DEFAULT_AUTHENTICATED_PATH)
    } catch (error) {
      if (isNetworkError(error)) {
        setErrors({
          form: 'Could not reach the server. Check your connection and try again.',
        })
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 401
      ) {
        setErrors({ form: 'Invalid email or password.' })
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 429
      ) {
        setErrors({
          form: 'Too many attempts. Please wait a few minutes and try again.',
        })
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string' &&
        error.message
      ) {
        setErrors({ form: error.message })
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center">
          <BrandMark />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-brand-navy">
            Sign in to Gradely
          </h1>
          <p className="mt-1.5 text-center text-sm leading-6 text-brand-muted">
            Smarter Reports. Better Learning.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {errors.form && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700"
            >
              {errors.form}
            </p>
          )}

          <div className="mb-4">
            <label htmlFor="email" className={labelClasses}>
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className={inputClasses}
              placeholder="you@school.edu"
            />
            {errors.email && (
              <p id="email-error" className="mt-1.5 text-sm text-red-700">
                {errors.email}
              </p>
            )}
          </div>

          <div className="mb-6">
            <label htmlFor="password" className={labelClasses}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className={inputClasses}
              placeholder="Your password"
            />
            {errors.password && (
              <p id="password-error" className="mt-1.5 text-sm text-red-700">
                {errors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-sm text-brand-muted">
            New to Gradely?{' '}
            <Link
              to="/register-school"
              className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              Register your school
            </Link>
          </p>
          <p className="mt-1 text-center text-xs text-brand-muted">
            Teachers: contact your school administrator for access.
          </p>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/"
            className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            Back to home
          </Link>
        </p>
      </div>
    </div>
  )
}
