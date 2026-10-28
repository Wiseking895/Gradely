import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  MailCheck,
  RefreshCw,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'
import ResendVerificationForm from '../components/ResendVerificationForm.tsx'
import { ApiError, authApi, type SessionUser } from '../lib/api.ts'

/**
 * Verification landing page for links emailed by
 * POST /api/auth/register-school and POST /api/auth/resend-verification.
 *
 * The token is redeemed automatically on arrival. Every outcome the backend
 * can report has an explicit state: success, expired, already used, invalid,
 * network failure, plus a resend form so an expired or lost link can be
 * replaced without contacting support. Without a token (e.g. an unverified
 * user sent here after sign-in) the page simply explains the next step.
 */

type VerificationState =
  | { kind: 'awaiting' }
  | { kind: 'verifying' }
  | { kind: 'success'; user: SessionUser }
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'invalid' }
  | { kind: 'network_error' }

function classifyError(error: unknown): VerificationState {
  if (error instanceof ApiError) {
    const details = error.details as { code?: string } | undefined
    switch (details?.code) {
      case 'token_expired':
        return { kind: 'expired' }
      case 'token_used':
        return { kind: 'used' }
      case 'token_invalid':
        return { kind: 'invalid' }
      default:
        break
    }
  }
  return { kind: 'network_error' }
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const [state, setState] = useState<VerificationState>(
    token ? { kind: 'verifying' } : { kind: 'awaiting' },
  )
  // StrictMode runs effects twice in development; only redeem once per token.
  const startedToken = useRef<string | null>(null)

  const verify = useCallback(async (value: string) => {
    setState({ kind: 'verifying' })
    try {
      const response = await authApi.verifyEmail(value)
      setState({ kind: 'success', user: response.user })
    } catch (error) {
      setState(classifyError(error))
    }
  }, [])

  useEffect(() => {
    if (!token || startedToken.current === token) return
    startedToken.current = token
    void verify(token)
  }, [token, verify])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-surface px-4 py-10">
      <main className="w-full max-w-xl">
        <div className="flex flex-col items-center text-center">
          <BrandMark />
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {state.kind === 'verifying' && <Verifying />}
          {state.kind === 'success' && <Success user={state.user} />}
          {state.kind === 'awaiting' && <Awaiting />}
          {state.kind === 'expired' && <Expired />}
          {state.kind === 'used' && <Used />}
          {state.kind === 'invalid' && <Invalid />}
          {state.kind === 'network_error' && (
            <NetworkError
              onRetry={() => {
                if (token) {
                  void verify(token)
                } else {
                  setState({ kind: 'awaiting' })
                }
              }}
            />
          )}

          {(state.kind === 'expired' ||
            state.kind === 'used' ||
            state.kind === 'invalid' ||
            state.kind === 'awaiting') && (
            <ResendVerificationForm />
          )}

          <p className="mt-6 text-center text-sm">
            <Link
              to="/login"
              className="font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              Go to sign in
            </Link>
          </p>
        </div>
      </main>

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

function Verifying() {
  return (
    <div role="status" className="text-center">
      <LoaderCircle
        className="mx-auto h-9 w-9 animate-spin text-brand-blue"
        aria-hidden="true"
      />
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-brand-navy">
        Verifying your email…
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        This only takes a moment. Please keep this page open.
      </p>
    </div>
  )
}

function Success({ user }: { user: SessionUser }) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        Email verified
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        {user.email} is confirmed and your school account is now active. Sign
        in to continue.
      </p>
      <Link
        to="/login"
        className="mt-6 flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-navy px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        Sign in
      </Link>
    </div>
  )
}

function Awaiting() {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-brand-navy">
        <MailCheck className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        Verify your email
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        Open the verification link we emailed you. Link expired or lost?
        Request a new one below and it will replace any earlier link.
      </p>
    </div>
  )
}

function Expired() {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        This link has expired
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        Verification links are valid for 24 hours. Request a new link below;
        any earlier link will stop working.
      </p>
    </div>
  )
}

function Used() {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-brand-navy">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        This link was already used
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        If your account is already verified, sign in. Otherwise request a new
        link below.
      </p>
    </div>
  )
}

function Invalid() {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-700">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        This link is not valid
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        The link may be incomplete or from an older request. Request a new
        verification link below.
      </p>
    </div>
  )
}

function NetworkError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-navy">
        We couldn&apos;t verify your email
      </h1>
      <p className="mt-2 text-sm leading-6 text-brand-muted">
        Check your connection and try again. If the problem continues, request
        a new link below.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-brand-navy px-4 py-2.5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Try again
      </button>
      <ResendVerificationForm />
    </div>
  )
}
