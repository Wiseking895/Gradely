import {
  Archive,
  BookOpen,
  Layers,
  LoaderCircle,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  schoolsApi,
  type ClassLevel,
  type SchoolClass,
} from '../../lib/api.ts'
import { describeApiError } from '../../lib/schoolErrors.ts'
import {
  cardClasses,
  inputClasses,
  labelClasses,
  pageSubtitleClasses,
  pageTitleClasses,
  primaryButtonClasses,
  secondaryButtonClasses,
  statusBadgeClasses,
} from '../../lib/ui.ts'
import type { SchoolOutletContext } from './schoolContext.ts'

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; classes: SchoolClass[]; levels: ClassLevel[] }
  | { kind: 'error'; message: string }

export default function ClassesPage() {
  const { schoolId, canManage } = useOutletContext<SchoolOutletContext>()
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [selectedLevel, setSelectedLevel] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [classesResponse, levelsResponse] = await Promise.all([
        schoolsApi.classes(schoolId),
        schoolsApi.classLevels(schoolId),
      ])
      setState({
        kind: 'ready',
        classes: classesResponse.classes,
        levels: levelsResponse.levels,
      })
    } catch (error) {
      setState({
        kind: 'error',
        message: describeApiError(error, 'Could not load classes.'),
      })
    }
  }, [schoolId])

  useEffect(() => {
    // Initial data fetch; state updates happen after the awaited requests.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (state.kind === 'loading') {
    return <Loading label="Loading classes…" />
  }

  if (state.kind === 'error') {
    return (
      <div className={cardClasses}>
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => {
            void load()
          }}
          className={`${secondaryButtonClasses} mt-4`}
        >
          Try again
        </button>
      </div>
    )
  }

  const { classes, levels } = state
  const usedLevels = new Set(classes.map((schoolClass) => schoolClass.level.code))
  const availableLevels = levels.filter((level) => !usedLevels.has(level.code))
  const activeCount = classes.filter((schoolClass) => schoolClass.status === 'active').length

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedLevel || creating) return

    setCreating(true)
    setActionError(null)
    try {
      await schoolsApi.createClass(schoolId, selectedLevel)
      setSelectedLevel('')
      await load()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not create the class.'))
    } finally {
      setCreating(false)
    }
  }

  async function toggleStatus(schoolClass: SchoolClass) {
    const next = schoolClass.status === 'active' ? 'archived' : 'active'
    if (
      next === 'archived' &&
      !window.confirm(
        `Archive ${schoolClass.level.label}? Its sections and assignments stay in place and the class can be reactivated later.`,
      )
    ) {
      return
    }

    setBusyId(schoolClass.id)
    setActionError(null)
    try {
      await schoolsApi.updateClassStatus(schoolId, schoolClass.id, next)
      await load()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not update the class.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitleClasses}>Classes</h1>
        <p className={pageSubtitleClasses}>
          Each of the 14 school levels can have one class. Add sections (arms or
          streams) inside a class and assign subjects to it.
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-brand-muted">
          {activeCount} active · {classes.length} of {levels.length} levels configured
        </p>
      </div>

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
          {actionError}
        </p>
      )}

      {canManage && (
        <form onSubmit={handleCreate} className={cardClasses}>
          <h2 className="font-semibold text-brand-ink">Add a class</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Levels already used by this school are not offered again. Reactivate
            an archived class instead.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-sm">
              <label htmlFor="class-level" className={labelClasses}>
                School level
              </label>
              <select
                id="class-level"
                value={selectedLevel}
                onChange={(event) => setSelectedLevel(event.target.value)}
                disabled={creating || availableLevels.length === 0}
                className={inputClasses}
              >
                <option value="">
                  {availableLevels.length === 0
                    ? 'All 14 levels already have a class'
                    : 'Choose a level'}
                </option>
                {availableLevels.map((level) => (
                  <option key={level.code} value={level.code}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={!selectedLevel || creating}
              className={primaryButtonClasses}
            >
              {creating ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {creating ? 'Adding…' : 'Add class'}
            </button>
          </div>
        </form>
      )}

      {classes.length === 0 ? (
        <div className={`${cardClasses} text-center`}>
          <Layers className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 font-semibold text-brand-ink">No classes yet</h2>
          <p className="mt-1 text-sm text-brand-muted">
            {canManage
              ? 'Choose a level above to create the school’s first class.'
              : 'This school has not created any classes yet.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {classes.map((schoolClass) => {
            const activeSections = schoolClass.sections.filter(
              (section) => section.status === 'active',
            )
            return (
              <li key={schoolClass.id} className={cardClasses}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-brand-navy">
                      {schoolClass.level.label}
                    </h2>
                    <p className="text-xs text-brand-muted">
                      Level {schoolClass.level.sortOrder} of 14
                    </p>
                  </div>
                  <span className={statusBadgeClasses(schoolClass.status)}>
                    {schoolClass.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-sm text-brand-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    {schoolClass.activeSubjectCount} active subject
                    {schoolClass.activeSubjectCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    {activeSections.length} active section
                    {activeSections.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-3 min-h-6">
                  {activeSections.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Sections">
                      {activeSections.map((section) => (
                        <li
                          key={section.id}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-brand-ink"
                        >
                          {section.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-brand-muted">No active sections yet.</p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <Link
                    to={`/dashboard/schools/${schoolId}/classes/${schoolClass.id}`}
                    className={secondaryButtonClasses}
                  >
                    Open class
                  </Link>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        void toggleStatus(schoolClass)
                      }}
                      disabled={busyId === schoolClass.id}
                      className={secondaryButtonClasses}
                    >
                      {schoolClass.status === 'active' ? (
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {busyId === schoolClass.id
                        ? 'Working…'
                        : schoolClass.status === 'active'
                          ? 'Archive'
                          : 'Reactivate'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!canManage && (
        <p className="text-xs text-brand-muted">
          Read-only view. Class creation and archiving are limited to school
          administrators.
        </p>
      )}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-brand-muted">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}
