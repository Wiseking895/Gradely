import { useEffect, useState } from 'react'
import { BarChart3, LogIn, LogOut, School, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'
import { healthApi } from '../lib/api.ts'
import { useAuth } from '../lib/authContext.ts'

type ApiStatus = 'checking' | 'online' | 'offline'

function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    let cancelled = false

    healthApi
      .get()
      .then(() => {
        if (!cancelled) setStatus('online')
      })
      .catch(() => {
        if (!cancelled) setStatus('offline')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return status
}

const apiStatusStyles: Record<ApiStatus, { label: string; className: string }> = {
  checking: {
    label: 'API: checking…',
    className: 'bg-slate-100 text-brand-muted',
  },
  online: {
    label: 'API: online',
    className: 'bg-brand-green/15 text-brand-navy',
  },
  offline: {
    label: 'API: offline',
    className: 'bg-red-100 text-red-700',
  },
}

const pillars = [
  {
    icon: School,
    title: 'Multi-school ready',
    description:
      'Built for school administrators managing many classes, terms, and report cycles.',
  },
  {
    icon: BarChart3,
    title: 'Clear report cards',
    description:
      'Structured scoring and report generation designed for consistency and speed.',
  },
  {
    icon: Sparkles,
    title: 'Smarter workflows',
    description:
      'Less manual spreadsheet work, more time focused on teaching and learning.',
  },
]

export default function HomePage() {
  const apiStatus = useApiStatus()
  const apiStatusStyle = apiStatusStyles[apiStatus]
  const { status: authStatus, user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <BrandMark variant="header" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${apiStatusStyle.className}`}
            >
              {apiStatusStyle.label}
            </span>
            <span className="rounded-full bg-brand-gold/15 px-3 py-1 text-xs font-semibold text-brand-navy">
              Phase 1.5 · Deployment ready
            </span>
            {authStatus === 'loading' && (
              <span className="text-xs text-brand-muted" aria-live="polite">
                Checking session…
              </span>
            )}
            {authStatus === 'anonymous' && (
              <Link
                to="/login"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                Sign in
              </Link>
            )}
            {authStatus === 'authenticated' && user && (
              <div className="flex items-center gap-2">
                <span className="hidden max-w-40 truncate rounded-full bg-brand-green/15 px-3 py-1 text-xs font-semibold text-brand-navy sm:inline">
                  {user.displayName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void logout()
                  }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-brand-navy text-white">
          <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-green" />
              Multi-school report card platform
            </p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Gradely
            </h1>
            <p className="mt-3 max-w-2xl text-xl font-medium text-blue-100 sm:text-2xl">
              Smarter Reports. Better Learning.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-blue-100/90 sm:text-base">
              This is the Phase 1 foundation of the Gradely platform: project
              structure, brand colours, routing, and the development
              toolchain. Product features arrive in later phases.
            </p>
          </div>
          <div aria-hidden="true" className="h-1.5 bg-brand-gold" />
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
          <h2 className="text-lg font-semibold text-brand-ink">
            What Gradely is working towards
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pillars.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-semibold text-brand-ink">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-brand-muted">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-brand-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            <span className="font-semibold text-brand-navy">Gradely</span> ·
            Smarter Reports. Better Learning.
          </p>
          <p>Foundation placeholder — not the final product design.</p>
        </div>
      </footer>
    </div>
  )
}
