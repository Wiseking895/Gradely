import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  schoolsApi,
  type ClassDetail,
  type SchoolSection,
  type Subject,
} from '../../lib/api.ts'
import { isUuid } from '../../lib/navigation.ts'
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
  | { kind: 'ready'; detail: ClassDetail; subjects: Subject[] }
  | { kind: 'error'; message: string }

export default function ClassDetailPage() {
  const { schoolId, canManage, refresh } = useOutletContext<SchoolOutletContext>()
  const { classId = '' } = useParams()
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [sectionName, setSectionName] = useState('')
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingSectionName, setEditingSectionName] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')

  const load = useCallback(async () => {
    if (!isUuid(classId)) {
      setState({ kind: 'error', message: 'That class link is not valid.' })
      return
    }
    try {
      const [detail, subjectsResponse] = await Promise.all([
        schoolsApi.classDetail(schoolId, classId),
        schoolsApi.subjects(schoolId),
      ])
      setState({ kind: 'ready', detail, subjects: subjectsResponse.subjects })
    } catch (error) {
      setState({
        kind: 'error',
        message: describeApiError(error, 'Could not load this class.'),
      })
    }
  }, [schoolId, classId])

  useEffect(() => {
    // Initial data fetch; state updates happen after the awaited requests.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-brand-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading class…
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className={cardClasses}>
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to={`/dashboard/schools/${schoolId}/classes`}
            className={secondaryButtonClasses}
          >
            Back to classes
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
      </div>
    )
  }

  const { detail, subjects } = state
  const schoolClass = detail.class
  const classActive = schoolClass.status === 'active'
  const activeAssignments = detail.assignments.filter(
    (assignment) => assignment.status === 'active',
  )
  const assignedSubjectIds = new Set(
    activeAssignments.map((assignment) => assignment.subject.id),
  )
  const availableSubjects = subjects.filter(
    (subject) =>
      subject.status === 'active' && !assignedSubjectIds.has(subject.id),
  )

  async function afterChange() {
    await load()
    await refresh()
  }

  async function toggleClassStatus() {
    const next = classActive ? 'archived' : 'active'
    if (
      next === 'archived' &&
      !window.confirm(
        `Archive ${schoolClass.level.label}? Sections and assignments stay in place and can be restored later.`,
      )
    ) {
      return
    }

    setBusy('class')
    setActionError(null)
    try {
      await schoolsApi.updateClassStatus(schoolId, schoolClass.id, next)
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not update the class.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleAddSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = sectionName.trim()
    if (!name || busy === 'new-section') return

    setBusy('new-section')
    setActionError(null)
    try {
      await schoolsApi.createSection(schoolId, schoolClass.id, name)
      setSectionName('')
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not add the section.'))
    } finally {
      setBusy(null)
    }
  }

  function startEditingSection(section: SchoolSection) {
    setEditingSectionId(section.id)
    setEditingSectionName(section.name)
    setActionError(null)
  }

  async function saveSectionName(section: SchoolSection) {
    const name = editingSectionName.trim()
    if (!name || busy === `section-${section.id}`) return

    setBusy(`section-${section.id}`)
    setActionError(null)
    try {
      await schoolsApi.updateSection(schoolId, schoolClass.id, section.id, {
        name,
      })
      setEditingSectionId(null)
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not rename the section.'))
    } finally {
      setBusy(null)
    }
  }

  async function toggleSectionStatus(section: SchoolSection) {
    const next = section.status === 'active' ? 'archived' : 'active'
    setBusy(`section-${section.id}`)
    setActionError(null)
    try {
      await schoolsApi.updateSection(schoolId, schoolClass.id, section.id, {
        status: next,
      })
      await afterChange()
    } catch (error) {
      setActionError(
        describeApiError(error, 'Could not update the section.'),
      )
    } finally {
      setBusy(null)
    }
  }

  async function handleAddAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSubjectId || busy === 'new-assignment') return

    setBusy('new-assignment')
    setActionError(null)
    try {
      await schoolsApi.createAssignment(
        schoolId,
        schoolClass.id,
        selectedSubjectId,
      )
      setSelectedSubjectId('')
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not assign the subject.'))
    } finally {
      setBusy(null)
    }
  }

  async function toggleAssignmentStatus(
    subjectId: string,
    current: 'active' | 'archived',
    subjectStatus: 'active' | 'archived',
  ) {
    if (current === 'archived' && (!classActive || subjectStatus !== 'active')) {
      return
    }
    setBusy(`assignment-${subjectId}`)
    setActionError(null)
    try {
      await schoolsApi.updateAssignmentStatus(
        schoolId,
        schoolClass.id,
        subjectId,
        current === 'active' ? 'archived' : 'active',
      )
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not update the assignment.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/dashboard/schools/${schoolId}/classes`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-navy underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to classes
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={pageTitleClasses}>{schoolClass.level.label}</h1>
              <span className={statusBadgeClasses(schoolClass.status)}>
                {schoolClass.status}
              </span>
            </div>
            <p className={pageSubtitleClasses}>
              Manage the class’s sections and the subjects assigned to it.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                void toggleClassStatus()
              }}
              disabled={busy === 'class'}
              className={secondaryButtonClasses}
            >
              {classActive ? (
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {busy === 'class'
                ? 'Working…'
                : classActive
                  ? 'Archive class'
                  : 'Reactivate class'}
            </button>
          )}
        </div>
      </div>

      {!classActive && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900">
          This class is archived. Reactivate it before adding sections or
          subjects. Existing sections and assignments remain visible.
        </p>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
          {actionError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cardClasses}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-brand-ink">Sections</h2>
            <span className="text-xs text-brand-muted">
              {detail.sections.filter((section) => section.status === 'active').length}{' '}
              active
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-brand-muted">
            Sections are arms or streams within this class, such as A, B, or
            Science.
          </p>

          {canManage && classActive && (
            <form onSubmit={handleAddSection} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-full">
                <label htmlFor="section-name" className={labelClasses}>
                  New section name
                </label>
                <input
                  id="section-name"
                  value={sectionName}
                  onChange={(event) => setSectionName(event.target.value)}
                  maxLength={40}
                  className={inputClasses}
                  placeholder="A"
                />
              </div>
              <button
                type="submit"
                disabled={!sectionName.trim() || busy === 'new-section'}
                className={primaryButtonClasses}
              >
                {busy === 'new-section' ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                Add
              </button>
            </form>
          )}

          {detail.sections.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-brand-muted">
              No sections have been added yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {detail.sections.map((section) => (
                <li key={section.id} className="py-3">
                  {editingSectionId === section.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label htmlFor={`section-${section.id}`} className="sr-only">
                        Section name
                      </label>
                      <input
                        id={`section-${section.id}`}
                        value={editingSectionName}
                        onChange={(event) =>
                          setEditingSectionName(event.target.value)
                        }
                        maxLength={40}
                        className={inputClasses}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void saveSectionName(section)
                          }}
                          disabled={
                            !editingSectionName.trim() ||
                            busy === `section-${section.id}`
                          }
                          className={secondaryButtonClasses}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSectionId(null)}
                          className={secondaryButtonClasses}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-brand-ink">
                          {section.name}
                        </span>
                        <span className={statusBadgeClasses(section.status)}>
                          {section.status}
                        </span>
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startEditingSection(section)}
                            className={secondaryButtonClasses}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            Rename
                          </button>
                          {section.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => {
                                void toggleSectionStatus(section)
                              }}
                              disabled={busy === `section-${section.id}`}
                              className={secondaryButtonClasses}
                            >
                              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                              Archive
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                void toggleSectionStatus(section)
                              }}
                              disabled={
                                !classActive || busy === `section-${section.id}`
                              }
                              className={secondaryButtonClasses}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              Reactivate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cardClasses}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-brand-ink">Subjects</h2>
            <span className="text-xs text-brand-muted">
              {activeAssignments.length} active
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-brand-muted">
            Subjects assigned to this class. Archived subjects cannot receive new
            assignments.
          </p>

          {canManage && classActive && (
            <form onSubmit={handleAddAssignment} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-full">
                <label htmlFor="assignment-subject" className={labelClasses}>
                  Assign a subject
                </label>
                <select
                  id="assignment-subject"
                  value={selectedSubjectId}
                  onChange={(event) => setSelectedSubjectId(event.target.value)}
                  disabled={availableSubjects.length === 0}
                  className={inputClasses}
                >
                  <option value="">
                    {availableSubjects.length === 0
                      ? 'No unassigned active subjects'
                      : 'Choose a subject'}
                  </option>
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={!selectedSubjectId || busy === 'new-assignment'}
                className={primaryButtonClasses}
              >
                {busy === 'new-assignment' ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                Assign
              </button>
            </form>
          )}

          {canManage && classActive && availableSubjects.length === 0 && (
            <p className="mt-2 text-xs leading-5 text-brand-muted">
              Create a subject on the{' '}
              <Link
                to={`/dashboard/schools/${schoolId}/subjects`}
                className="font-medium text-brand-navy underline-offset-4 hover:underline"
              >
                Subjects page
              </Link>{' '}
              or reactivate an archived subject first.
            </p>
          )}

          {detail.assignments.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-brand-muted">
              No subjects assigned yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {detail.assignments.map((assignment) => {
                const canReactivate =
                  classActive && assignment.subject.status === 'active'
                return (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen
                        className="h-4 w-4 text-brand-blue"
                        aria-hidden="true"
                      />
                      <span className="font-medium text-brand-ink">
                        {assignment.subject.name}
                      </span>
                      <span className={statusBadgeClasses(assignment.status)}>
                        {assignment.status}
                      </span>
                      {assignment.subject.status === 'archived' && (
                        <span className="text-xs font-medium text-amber-700">
                          subject archived
                        </span>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          void toggleAssignmentStatus(
                            assignment.subject.id,
                            assignment.status,
                            assignment.subject.status,
                          )
                        }}
                        disabled={
                          assignment.status === 'archived'
                            ? !canReactivate ||
                              busy === `assignment-${assignment.subject.id}`
                            : busy === `assignment-${assignment.subject.id}`
                        }
                        className={secondaryButtonClasses}
                      >
                        {assignment.status === 'active' ? (
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {assignment.status === 'active'
                          ? 'Unassign'
                          : 'Reactivate'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
