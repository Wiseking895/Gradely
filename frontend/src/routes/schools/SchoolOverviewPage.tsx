import {
  BookOpen,
  CheckCircle2,
  Circle,
  Layers,
  School as SchoolIcon,
  UserRound,
  Users,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import type { SchoolOutletContext } from './schoolContext.ts'
import {
  cardClasses,
  formatDate,
  linkClasses,
  pageSubtitleClasses,
  pageTitleClasses,
  primaryButtonClasses,
  statusBadgeClasses,
} from '../../lib/ui.ts'

const setupSteps = [
  {
    key: 'profile' as const,
    label: 'School profile',
    description: 'Add the school name and contact details.',
    segment: 'profile',
  },
  {
    key: 'classes' as const,
    label: 'At least one class',
    description: 'Create the classes your school teaches.',
    segment: 'classes',
  },
  {
    key: 'subjects' as const,
    label: 'At least one subject',
    description: 'Build the subject list used for assignments.',
    segment: 'subjects',
  },
  {
    key: 'assignments' as const,
    label: 'At least one assignment',
    description: 'Assign a subject to a class.',
    segment: 'classes',
  },
]

export default function SchoolOverviewPage() {
  const { schoolId, overview, canManage } = useOutletContext<SchoolOutletContext>()
  const { school, setup } = overview

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitleClasses}>School overview</h1>
          <p className={pageSubtitleClasses}>
            {canManage
              ? 'Complete the setup checklist, then keep classes and subjects current.'
              : 'Read-only overview of this school’s setup and management data.'}
          </p>
        </div>
        {canManage && (
          <Link
            to={`/dashboard/schools/${schoolId}/profile`}
            className={primaryButtonClasses}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Edit profile
          </Link>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className={`${cardClasses} lg:col-span-3`}>
          <div className="flex flex-wrap items-start gap-4">
            {school.logo.url ? (
              <img
                src={school.logo.url}
                alt={`${school.name} logo`}
                className="h-20 w-20 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-2"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-brand-blue/10 text-2xl font-bold text-brand-blue"
              >
                {school.name.trim().charAt(0).toUpperCase() || 'S'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-brand-navy">{school.name}</h2>
                <span className={statusBadgeClasses(
                  school.status === 'active' ? 'active' : 'archived',
                )}>
                  {school.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-brand-muted">
                Identifier: <span className="font-mono">{school.slug}</span>
              </p>
              <p className="mt-3 text-sm leading-6 text-brand-muted">
                {school.address ?? 'No address added yet.'}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
                    Contact email
                  </dt>
                  <dd className="break-words text-brand-ink">
                    {school.contactEmail ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
                    Phone
                  </dt>
                  <dd className="text-brand-ink">{school.phone ?? '—'}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-brand-muted">
            <p>
              Profile saved: {formatDate(school.profileCompletedAt)} · Setup
              milestone: {formatDate(setup.completedAt)}
            </p>
          </div>
        </section>

        <section className={`${cardClasses} lg:col-span-2`}>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green/15 text-brand-navy">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="font-semibold text-brand-ink">Setup checklist</h2>
          </div>

          {setup.complete ? (
            <p className="mt-3 rounded-lg bg-brand-green/10 px-3 py-2 text-sm leading-6 text-brand-navy">
              Setup is complete. You can keep refining classes and subjects at
              any time.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-brand-muted">
              Finish the four required steps to complete school setup. The logo
              is optional.
            </p>
          )}

          <ul className="mt-4 space-y-3">
            {setupSteps.map((step) => {
              const done = setup.steps[step.key]
              return (
                <li key={step.key} className="flex items-start gap-2.5">
                  {done ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-green"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 h-4 w-4 shrink-0 text-slate-300"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <Link
                      to={`/dashboard/schools/${schoolId}/${step.segment}`}
                      className="text-sm font-medium text-brand-navy underline-offset-4 hover:underline"
                    >
                      {step.label}
                    </Link>
                    <p className="text-xs leading-5 text-brand-muted">
                      {done ? 'Done' : step.description}
                    </p>
                  </div>
                </li>
              )
            })}
            <li className="flex items-start gap-2.5">
              {setup.optional.logo ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-green"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-300"
                  aria-hidden="true"
                />
              )}
              <div>
                <Link
                  to={`/dashboard/schools/${schoolId}/profile`}
                  className="text-sm font-medium text-brand-navy underline-offset-4 hover:underline"
                >
                  School logo
                </Link>
                <p className="text-xs leading-5 text-brand-muted">
                  Optional · {setup.optional.logo ? 'Added' : 'Not added'}
                </p>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="counts-heading">
        <h2 id="counts-heading" className="font-semibold text-brand-ink">
          At a glance
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountCard
            icon={Layers}
            label="Active classes"
            value={setup.counts.classes}
            note={`${setup.counts.archivedClasses} archived`}
            to={`/dashboard/schools/${schoolId}/classes`}
          />
          <CountCard
            icon={SchoolIcon}
            label="Active sections"
            value={setup.counts.sections}
            note="Across all classes"
            to={`/dashboard/schools/${schoolId}/classes`}
          />
          <CountCard
            icon={BookOpen}
            label="Active subjects"
            value={setup.counts.subjects}
            note={`${setup.counts.archivedSubjects} archived`}
            to={`/dashboard/schools/${schoolId}/subjects`}
          />
          <CountCard
            icon={Users}
            label="Active assignments"
            value={setup.counts.assignments}
            note="Subject-to-class links"
            to={`/dashboard/schools/${schoolId}/classes`}
          />
        </div>
      </section>

      <p className="text-sm text-brand-muted">
        {canManage ? (
          <>
            Looking for something specific? Browse{' '}
            <Link to={`/dashboard/schools/${schoolId}/classes`} className={linkClasses}>
              classes
            </Link>{' '}
            or{' '}
            <Link to={`/dashboard/schools/${schoolId}/subjects`} className={linkClasses}>
              subjects
            </Link>
            .
          </>
        ) : (
          'Platform oversight is read-only; management actions are hidden.'
        )}
      </p>
    </div>
  )
}

function CountCard({
  icon: Icon,
  label,
  value,
  note,
  to,
}: {
  icon: typeof Layers
  label: string
  value: number
  note: string
  to: string
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-blue/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-2xl font-bold text-brand-navy">{value}</p>
      <p className="text-sm font-medium text-brand-ink">{label}</p>
      <p className="text-xs text-brand-muted">{note}</p>
    </Link>
  )
}
