import { LayoutDashboard, LogOut } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import BrandMark from './BrandMark.tsx'
import { useAuth } from '../lib/authContext.ts'
import { secondaryButtonClasses } from '../lib/ui.ts'

type DashboardHeaderProps = {
  schoolId?: string
  schoolName?: string
  schoolStatus?: string
}

const navItems = [
  { label: 'Overview', segment: '' },
  { label: 'Profile', segment: 'profile' },
  { label: 'Classes', segment: 'classes' },
  { label: 'Subjects', segment: 'subjects' },
]

export default function DashboardHeader({
  schoolId,
  schoolName,
  schoolStatus,
}: DashboardHeaderProps) {
  const { user, memberships, logout } = useAuth()
  const navigate = useNavigate()

  const switchable = memberships.filter(
    (membership) =>
      membership.role === 'school_admin' && membership.schoolStatus === 'active',
  )

  async function handleSignOut() {
    await logout()
    navigate('/')
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark variant="header" />
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-brand-navy">
                {schoolName ?? 'Gradely dashboard'}
              </p>
              <p className="text-xs text-brand-muted">
                {user ? `Signed in as ${user.displayName}` : 'Gradely'}
                {schoolStatus && schoolStatus !== 'active' && (
                  <span className="ml-2 font-semibold uppercase tracking-wide text-amber-700">
                    {schoolStatus}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {switchable.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-brand-muted">
                <span className="sr-only">Switch school</span>
                <select
                  aria-label="Switch school"
                  value={schoolId ?? ''}
                  onChange={(event) => {
                    if (event.target.value) {
                      navigate(`/dashboard/schools/${event.target.value}`)
                    }
                  }}
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-brand-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                >
                  {switchable.map((membership) => (
                    <option key={membership.schoolId} value={membership.schoolId}>
                      {membership.schoolName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Link
              to="/dashboard"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
              All schools
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

        {schoolId && (
          <nav
            aria-label="School management"
            className="mt-4 flex gap-1 overflow-x-auto pb-1"
          >
            {navItems.map((item) => {
              const to = `/dashboard/schools/${schoolId}${
                item.segment ? `/${item.segment}` : ''
              }`
              return (
                <NavLink
                  key={item.label}
                  to={to}
                  end={item.segment === ''}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${
                      isActive
                        ? 'bg-brand-blue/10 text-brand-navy'
                        : 'text-brand-muted hover:bg-slate-50 hover:text-brand-navy'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        )}
      </div>
    </header>
  )
}
