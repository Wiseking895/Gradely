import { useState, type FormEvent } from 'react'
import { Mail } from 'lucide-react'
import { ApiError, authApi } from '../lib/api.ts'
import { isNetworkError } from '../lib/authContext.ts'

/**
 * Shared "resend verification email" form used by the registration success
 * screen and the verification screen (expired / used / invalid states).
 *
 * The backend answers 202 uniformly whether or not the account exists, so
 * this form never implies that an address is registered. Rate limiting (429)
 * is surfaced with the server's Retry-After value.
 */

const inputClasses =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

const labelClasses = 'mb-1.5 block text-sm font-medium text-brand-ink'

function resendError(error: unknown): string {
  if (isNetworkError(error)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const details = error.details as { retryAfterSeconds?: number } | undefined
      const seconds = details?.retryAfterSeconds
      if (typeof seconds === 'number' && seconds > 0) {
        return `Too many requests. Please wait ${seconds} seconds and try again.`
      }
      return 'Too many requests. Please wait a few minutes and try again.'
    }
    if (error.message) {
      return error.message
    }
  }
  return 'Something went wrong. Please try again.'
}

export default function ResendVerificationForm({
  defaultEmail = '',
}: {
  defaultEmail?: string
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [message, setMessage] = useState<
    { tone: 'success' | 'error'; text: string } | null
  >(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmed = email.trim()
    if (!trimmed) {
      setEmailError('Email is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.')
      return
    }

    setEmailError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      await authApi.resendVerification(trimmed)
      setMessage({
        tone: 'success',
        text: 'If that account exists and is not yet verified, a new verification link has been sent.',
      })
    } catch (error) {
      setMessage({ tone: 'error', text: resendError(error) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6 text-left">
      <label htmlFor="resend-email" className={labelClasses}>
        Email address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            setEmailError(null)
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'resend-email-error' : undefined}
          className={inputClasses}
          placeholder="you@school.edu"
        />
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          {submitting ? 'Sending…' : 'Resend link'}
        </button>
      </div>
      {emailError && (
        <p id="resend-email-error" className="mt-1.5 text-sm text-red-700">
          {emailError}
        </p>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-lg px-3 py-2.5 text-sm leading-6 ${
            message.tone === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  )
}
