import {
  Archive,
  BookOpen,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { schoolsApi, type Subject } from '../../lib/api.ts'
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
  | { kind: 'ready'; subjects: Subject[] }
  | { kind: 'error'; message: string }

export default function SubjectsPage() {
  const { schoolId, canManage, refresh } = useOutletContext<SchoolOutletContext>()
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await schoolsApi.subjects(schoolId)
      setState({ kind: 'ready', subjects: response.subjects })
    } catch (error) {
      setState({
        kind: 'error',
        message: describeApiError(error, 'Could not load subjects.'),
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
      <div className="flex items-center gap-2 py-8 text-sm text-brand-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading subjects…
      </div>
    )
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

  const { subjects } = state
  const activeCount = subjects.filter((subject) => subject.status === 'active').length

  async function afterChange() {
    await load()
    await refresh()
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = name.trim()
    if (!value || creating) return

    setCreating(true)
    setActionError(null)
    try {
      await schoolsApi.createSubject(schoolId, value)
      setName('')
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not create the subject.'))
    } finally {
      setCreating(false)
    }
  }

  async function saveRename(subject: Subject) {
    const value = editingName.trim()
    if (!value || busy === subject.id) return

    setBusy(subject.id)
    setActionError(null)
    try {
      await schoolsApi.updateSubject(schoolId, subject.id, { name: value })
      setEditingId(null)
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not rename the subject.'))
    } finally {
      setBusy(null)
    }
  }

  async function toggleStatus(subject: Subject) {
    const next = subject.status === 'active' ? 'archived' : 'active'
    if (
      next === 'archived' &&
      !window.confirm(
        `Archive ${subject.name}? It stays linked to classes but cannot receive new assignments until reactivated.`,
      )
    ) {
      return
    }

    setBusy(subject.id)
    setActionError(null)
    try {
      await schoolsApi.updateSubject(schoolId, subject.id, { status: next })
      await afterChange()
    } catch (error) {
      setActionError(describeApiError(error, 'Could not update the subject.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitleClasses}>Subjects</h1>
        <p className={pageSubtitleClasses}>
          Create the subjects your school teaches, then assign them to classes
          from each class’s page.
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-brand-muted">
          {activeCount} active · {subjects.length - activeCount} archived
        </p>
      </div>

      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
          {actionError}
        </p>
      )}

      {canManage && (
        <form onSubmit={handleCreate} className={cardClasses}>
          <h2 className="font-semibold text-brand-ink">Add a subject</h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-sm">
              <label htmlFor="subject-name" className={labelClasses}>
                Subject name
              </label>
              <input
                id="subject-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className={inputClasses}
                placeholder="Mathematics"
              />
            </div>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className={primaryButtonClasses}
            >
              {creating ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {creating ? 'Adding…' : 'Add subject'}
            </button>
          </div>
        </form>
      )}

      {subjects.length === 0 ? (
        <div className={`${cardClasses} text-center`}>
          <BookOpen className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 font-semibold text-brand-ink">No subjects yet</h2>
          <p className="mt-1 text-sm text-brand-muted">
            {canManage
              ? 'Add the first subject above, then assign it to a class.'
              : 'This school has not created any subjects yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {subjects.map((subject) => (
            <li key={subject.id} className={cardClasses}>
              {editingId === subject.id ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label htmlFor={`subject-${subject.id}`} className="sr-only">
                    Subject name
                  </label>
                  <input
                    id={`subject-${subject.id}`}
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    maxLength={120}
                    className={inputClasses}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void saveRename(subject)
                      }}
                      disabled={!editingName.trim() || busy === subject.id}
                      className={secondaryButtonClasses}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className={secondaryButtonClasses}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-brand-ink">
                        {subject.name}
                      </h2>
                      <span className={statusBadgeClasses(subject.status)}>
                        {subject.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-brand-muted">
                      Used in {subject.activeAssignmentCount} active class
                      {subject.activeAssignmentCount === 1 ? '' : 'es'}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(subject.id)
                          setEditingName(subject.name)
                          setActionError(null)
                        }}
                        className={secondaryButtonClasses}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void toggleStatus(subject)
                        }}
                        disabled={busy === subject.id}
                        className={secondaryButtonClasses}
                      >
                        {subject.status === 'active' ? (
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {busy === subject.id
                          ? 'Working…'
                          : subject.status === 'active'
                            ? 'Archive'
                            : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canManage && (
        <p className="text-xs text-brand-muted">
          Read-only view. Subject management is limited to school administrators.
        </p>
      )}
    </div>
  )
}
