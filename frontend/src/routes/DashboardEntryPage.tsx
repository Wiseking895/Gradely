import { ArrowRight, LogOut, School, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'
import { useAuth } from '../lib/authContext.ts'
import { isUuid } from '../lib/navigation.ts'
import {
  cardClasses,
  inputClasses,
  labelClasses,
  linkClasses,
  pageSubtitleClasses,
  pageTitleClasses,
  primaryButtonClasses,
  secondaryButtonClasses,
  statusBadgeClasses,
} from '../lib/ui.ts'

export default function DashboardEntryPage() {
  const { user, memberships, logout } = useAuth()
  const navigate = useNavigate()
  const [schoolId, setSchoolId] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)

  const adminMemberships = memberships.filter(
    (membership) =>
      membership.role === 'school_admin' && membership.schoolStatus === 'active',
  )

  // One active school administrator membership goes straight to that school.
  // Multiple schools are shown so the choice is explicit.
  if (adminMemberships.length === 1) {
    return (
      <Navigate
        to={`/dashboard/schools/${adminMemberships[0].schoolId}`}
        replace
      />
    )
  }

  async function handleSignOut() {
    await logout()
    navigate('/')
  }

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = schoolId.trim()
    if (!isUuid(value)) {
      setLookupError('Enter the full school ID (a UUID), not the school name.')
      return
    }
    setLookupError(null)
    navigate(`/dashboard/schools/${value}`)
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark variant="header" />
            <div>
              <p className="text-base font-bold text-brand-navy">Gradely</p>
              <p className="text-xs text-brand-muted">
                {user ? `Signed in as ${user.displayName}` : 'Dashboard'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className={secondaryButtonClasses}>
              Home
            </Link>
            <button
              type="button"
              onClick={() => {
                void handleSignOut()
              }}
              className={secondaryButtonClasses}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <h1 className={pageTitleClasses}>Your schools</h1>
        <p className={pageSubtitleClasses}>
          Choose a school to open its dashboard.
        </p>

        {adminMemberships.length > 1 && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {adminMemberships.map((membership) => (
              <li key={membership.schoolId} className={cardClasses}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
                    <School className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-brand-ink">
                      {membership.schoolName}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-brand-muted">
                      {membership.schoolSlug}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/dashboard/schools/${membership.schoolId}`}
                  className={`${primaryButtonClasses} mt-4 w-full`}
                >
                  Open dashboard
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {adminMemberships.length === 0 && (
          <div className={`${cardClasses} mt-6`}>
            <h2 className="font-semibold text-brand-ink">No administrator school</h2>
            <p className="mt-1 text-sm leading-6 text-brand-muted">
              {user?.isPlatformAdmin
                ? 'Use the platform oversight lookup below to open a school by its ID. There is no platform-wide school directory.'
                : 'Your account does not have an active school administrator membership. Ask your school administrator to check your access.'}
            </p>
            {!user?.isPlatformAdmin && memberships.length > 0 && (
              <ul className="mt-4 space-y-2">
                {memberships.map((membership) => (
                  <li
                    key={membership.schoolId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-brand-ink">
                      {membership.schoolName}
                    </span>
                    <span className="text-xs text-brand-muted">
                      {membership.role.replace('_', ' ')} ·{' '}
                      {membership.schoolStatus}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {user?.isPlatformAdmin && (
          <section className={`${cardClasses} mt-6`}>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green/15 text-brand-navy">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="font-semibold text-brand-ink">
                Platform oversight
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-brand-muted">
              Platform administrators can view any school’s overview, classes,
              sections, and subjects, including suspended or archived schools.
              Management actions stay read-only.
            </p>

            <form onSubmit={handleLookup} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full">
                <label htmlFor="oversight-school-id" className={labelClasses}>
                  School ID
                </label>
                <input
                  id="oversight-school-id"
                  value={schoolId}
                  onChange={(event) => setSchoolId(event.target.value)}
                  className={`${inputClasses} font-mono text-sm`}
                  placeholder="00000000-0000-4000-8000-000000000000"
                  spellCheck={false}
                />
              </div>
              <button type="submit" className={primaryButtonClasses}>
                Open read-only
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
            {lookupError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {lookupError}
              </p>
            )}

            {memberships.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-brand-ink">
                  Your memberships
                </h3>
                <ul className="mt-2 space-y-2">
                  {memberships.map((membership) => (
                    <li
                      key={membership.schoolId}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-sm text-brand-ink">
                        {membership.schoolName}{' '}
                        <span className="text-xs text-brand-muted">
                          ({membership.role.replace('_', ' ')})
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={statusBadgeClasses(
                            membership.schoolStatus === 'active'
                              ? 'active'
                              : 'archived',
                          )}
                        >
                          {membership.schoolStatus}
                        </span>
                        <Link
                          to={`/dashboard/schools/${membership.schoolId}`}
                          className={linkClasses}
                        >
                          Open
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <p className="mt-8 text-sm text-brand-muted">
          Need the public site?{' '}
          <Link to="/" className={linkClasses}>
            Back to home
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
