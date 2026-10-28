import { LoaderCircle, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import DashboardHeader from '../../components/DashboardHeader.tsx'
import { ApiError, schoolsApi, type SchoolOverview } from '../../lib/api.ts'
import { isUuid } from '../../lib/navigation.ts'
import { describeApiError } from '../../lib/schoolErrors.ts'
import {
  cardClasses,
  linkClasses,
  pageTitleClasses,
  secondaryButtonClasses,
} from '../../lib/ui.ts'
import type { SchoolOutletContext } from './schoolContext.ts'

type LayoutState =
  | { kind: 'loading' }
  | { kind: 'ready'; overview: SchoolOverview }
  | { kind: 'error'; message: string; status: number }

export default function SchoolLayout() {
  const { schoolId = '' } = useParams()
  const [state, setState] = useState<LayoutState>({ kind: 'loading' })

  const load = useCallback(async () => {
    if (!isUuid(schoolId)) {
      setState({
        kind: 'error',
        status: 404,
        message: 'That school link is not valid.',
      })
      return
    }

    setState((current) =>
      current.kind === 'ready' ? current : { kind: 'loading' },
    )
    try {
      const overview = await schoolsApi.overview(schoolId)
      setState({ kind: 'ready', overview })
    } catch (error) {
      setState({
        kind: 'error',
        status: error instanceof ApiError ? error.status : 0,
        message: describeApiError(error, 'Could not load this school.'),
      })
    }
  }, [schoolId])

  useEffect(() => {
    // Initial data fetch; state updates happen after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (state.kind === 'loading') {
    return (
      <div className="min-h-screen bg-brand-surface">
        <DashboardHeader />
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-16 text-sm text-brand-muted sm:px-6">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading school…
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="min-h-screen bg-brand-surface">
        <DashboardHeader />
        <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
          <div className={cardClasses}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <h1 className={`mt-4 ${pageTitleClasses}`}>
              {state.status === 403 ? 'Access restricted' : 'School unavailable'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-brand-muted">
              {state.message}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/dashboard" className={secondaryButtonClasses}>
                Back to dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  void load()
                }}
                className={secondaryButtonClasses}
              >
                Try again
              </button>
            </div>
            <p className="mt-4 text-xs text-brand-muted">
              If you believe you should have access, ask your school
              administrator to check your membership.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const { overview } = state
  const context: SchoolOutletContext = {
    schoolId,
    overview,
    canManage: overview.canManage,
    isPlatformAdmin: overview.role === 'platform_admin',
    refresh: load,
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <DashboardHeader
        schoolId={schoolId}
        schoolName={overview.school.name}
        schoolStatus={overview.school.status}
      />

      {overview.role === 'platform_admin' && (
        <div className="border-b border-amber-200 bg-amber-50">
          <p className="mx-auto w-full max-w-6xl px-4 py-2.5 text-sm text-amber-900 sm:px-6">
            Platform administrator view — read-only. School staff manage their
            own profile, classes, sections, subjects, and assignments.
          </p>
        </div>
      )}

      {overview.school.status !== 'active' && (
        <div className="border-b border-amber-200 bg-amber-50">
          <p className="mx-auto w-full max-w-6xl px-4 py-2.5 text-sm text-amber-900 sm:px-6">
            This school is currently {overview.school.status}. School members
            cannot access management features until it is active again.
          </p>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div key={schoolId}>
          <Outlet context={context} />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-brand-muted sm:px-6">
          <Link to="/" className={linkClasses}>
            Gradely
          </Link>{' '}
          · Smarter Reports. Better Learning.
        </div>
      </footer>
    </div>
  )
}
