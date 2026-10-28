import { ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react'
import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { useOutletContext } from 'react-router-dom'
import { schoolsApi } from '../../lib/api.ts'
import { describeApiError } from '../../lib/schoolErrors.ts'
import {
  cardClasses,
  dangerButtonClasses,
  errorTextClasses,
  formatDate,
  helpClasses,
  inputClasses,
  labelClasses,
  pageSubtitleClasses,
  pageTitleClasses,
  primaryButtonClasses,
  secondaryButtonClasses,
} from '../../lib/ui.ts'
import type { SchoolOutletContext } from './schoolContext.ts'

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type FormValues = {
  name: string
  contactEmail: string
  phone: string
  address: string
}

type FormErrors = Partial<Record<keyof FormValues | 'form', string>>

function valuesFromSchool(school: SchoolOutletContext['overview']['school']): FormValues {
  return {
    name: school.name,
    contactEmail: school.contactEmail ?? '',
    phone: school.phone ?? '',
    address: school.address ?? '',
  }
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {}
  const name = values.name.trim()
  const email = values.contactEmail.trim()
  const phone = values.phone.trim()
  const address = values.address.trim()

  if (name.length < 2 || name.length > 120) {
    errors.name = 'School name must be 2–120 characters.'
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.contactEmail = 'Enter a valid contact email address.'
  }
  if (phone && (phone.length < 3 || phone.length > 40)) {
    errors.phone = 'Phone must be 3–40 characters.'
  }
  if (address && address.length > 300) {
    errors.address = 'Address must be 300 characters or fewer.'
  }
  return errors
}

export default function SchoolProfilePage() {
  const { schoolId, overview, canManage, refresh } =
    useOutletContext<SchoolOutletContext>()
  const school = overview.school

  const [values, setValues] = useState<FormValues>(() => valuesFromSchool(school))
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [logoNotice, setLogoNotice] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  // Reset local edits only when switching to a different school. A logo
  // refresh must not discard unsaved profile edits. SchoolLayout remounts this
  // page on a school change (keyed outlet), so no synchronisation effect is
  // needed here.
  function updateField(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setNotice(null)
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    const clientErrors = validate(values)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length > 0) return

    setSaving(true)
    try {
      const result = await schoolsApi.updateProfile(schoolId, {
        name: values.name.trim(),
        contactEmail: values.contactEmail.trim()
          ? values.contactEmail.trim().toLowerCase()
          : null,
        phone: values.phone.trim() || null,
        address: values.address.trim() || null,
      })
      setValues(valuesFromSchool(result.school))
      setNotice('School profile saved.')
      await refresh()
    } catch (error) {
      setErrors({ form: describeApiError(error, 'Could not save the profile.') })
    } finally {
      setSaving(false)
    }
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setLogoFile(file)
    setLogoError(null)
    setLogoNotice(null)

    if (!file) return
    if (!LOGO_TYPES.has(file.type)) {
      setLogoError('Choose a PNG, JPEG, or WebP image.')
      setLogoFile(null)
      event.target.value = ''
      return
    }
    if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
      setLogoError('The logo must be larger than 0 bytes and no more than 2 MB.')
      setLogoFile(null)
      event.target.value = ''
    }
  }

  async function handleLogoUpload() {
    if (!logoFile || logoBusy) return
    setLogoBusy(true)
    setLogoError(null)
    setLogoNotice(null)

    try {
      const ticket = await schoolsApi.requestLogoUpload(schoolId, {
        contentType: logoFile.type,
        fileSizeBytes: logoFile.size,
      })

      let uploadResponse: Response
      try {
        // Direct-to-R2 upload. No API credentials are sent to storage; the
        // presigned URL is short-lived and scoped to this one object.
        uploadResponse = await fetch(ticket.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': logoFile.type },
          body: logoFile,
        })
      } catch {
        throw new Error(
          'Could not upload the image to storage. This is usually a CORS or network configuration issue.',
        )
      }

      if (!uploadResponse.ok) {
        throw new Error(
          `The storage service rejected the upload (${uploadResponse.status}). Please try again.`,
        )
      }

      await schoolsApi.completeLogoUpload(schoolId, {
        uploadId: ticket.uploadId,
        contentType: logoFile.type,
      })
      await refresh()
      setLogoFile(null)
      if (logoInput.current) logoInput.current.value = ''
      setLogoNotice('School logo updated.')
    } catch (error) {
      setLogoError(
        error instanceof Error && !('status' in error)
          ? error.message
          : describeApiError(error, 'Could not update the school logo.'),
      )
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    if (logoBusy) return
    if (!window.confirm('Remove the school logo?')) return

    setLogoBusy(true)
    setLogoError(null)
    setLogoNotice(null)
    try {
      await schoolsApi.removeLogo(schoolId)
      await refresh()
      setLogoNotice('School logo removed.')
    } catch (error) {
      setLogoError(describeApiError(error, 'Could not remove the school logo.'))
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={pageTitleClasses}>School profile</h1>
        <p className={pageSubtitleClasses}>
          Keep the school’s contact details current. The identifier is permanent
          once the school is created.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <form
          onSubmit={handleSave}
          noValidate
          className={`${cardClasses} lg:col-span-3`}
        >
          <h2 className="font-semibold text-brand-ink">School details</h2>

          {errors.form && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
              {errors.form}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 rounded-lg bg-brand-green/10 px-3 py-2.5 text-sm leading-6 text-brand-navy">
              {notice}
            </p>
          )}

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="school-name" className={labelClasses}>
                School name
              </label>
              <input
                id="school-name"
                value={values.name}
                onChange={(event) => updateField('name', event.target.value)}
                disabled={!canManage}
                required
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'school-name-error' : undefined}
                className={inputClasses}
              />
              {errors.name && (
                <p id="school-name-error" className={errorTextClasses}>
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="school-slug" className={labelClasses}>
                School identifier
              </label>
              <input
                id="school-slug"
                value={school.slug}
                readOnly
                disabled
                className={inputClasses}
              />
              <p className={helpClasses}>
                Permanent. Used in school links and cannot be changed.
              </p>
            </div>

            <div>
              <label htmlFor="school-email" className={labelClasses}>
                Contact email <span className="font-normal text-brand-muted">(optional)</span>
              </label>
              <input
                id="school-email"
                type="email"
                value={values.contactEmail}
                onChange={(event) => updateField('contactEmail', event.target.value)}
                disabled={!canManage}
                aria-invalid={errors.contactEmail ? true : undefined}
                aria-describedby={
                  errors.contactEmail ? 'school-email-error' : undefined
                }
                className={inputClasses}
                placeholder="office@school.edu"
              />
              {errors.contactEmail && (
                <p id="school-email-error" className={errorTextClasses}>
                  {errors.contactEmail}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="school-phone" className={labelClasses}>
                Phone <span className="font-normal text-brand-muted">(optional)</span>
              </label>
              <input
                id="school-phone"
                type="tel"
                value={values.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                disabled={!canManage}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'school-phone-error' : undefined}
                className={inputClasses}
                placeholder="+233 20 000 0000"
              />
              {errors.phone && (
                <p id="school-phone-error" className={errorTextClasses}>
                  {errors.phone}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="school-address" className={labelClasses}>
                Address <span className="font-normal text-brand-muted">(optional)</span>
              </label>
              <textarea
                id="school-address"
                value={values.address}
                onChange={(event) => updateField('address', event.target.value)}
                disabled={!canManage}
                rows={3}
                aria-invalid={errors.address ? true : undefined}
                aria-describedby={errors.address ? 'school-address-error' : undefined}
                className={`${inputClasses} resize-y`}
                placeholder="Street, city, region"
              />
              {errors.address && (
                <p id="school-address-error" className={errorTextClasses}>
                  {errors.address}
                </p>
              )}
            </div>
          </div>

          {canManage && (
            <button
              type="submit"
              disabled={saving}
              className={`${primaryButtonClasses} mt-5`}
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          )}

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-brand-muted">
            Profile last saved: {formatDate(school.profileCompletedAt)}
          </p>
        </form>

        <section className={`${cardClasses} lg:col-span-2`}>
          <h2 className="font-semibold text-brand-ink">School logo</h2>
          <p className="mt-1 text-sm leading-6 text-brand-muted">
            Optional. A square PNG, JPEG, or WebP image up to 2 MB works best.
            This is separate from the Gradely brand mark.
          </p>

          {logoError && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
              {logoError}
            </p>
          )}
          {logoNotice && (
            <p role="status" className="mt-3 rounded-lg bg-brand-green/10 px-3 py-2.5 text-sm leading-6 text-brand-navy">
              {logoNotice}
            </p>
          )}

          <div className="mt-4 flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            {school.logo.url ? (
              <img
                src={school.logo.url}
                alt={`${school.name} logo`}
                className="max-h-32 max-w-full rounded-lg object-contain"
              />
            ) : (
              <div className="text-center">
                <ImagePlus
                  className="mx-auto h-8 w-8 text-slate-400"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm text-brand-muted">
                  {overview.setup.optional.logo
                    ? 'A logo is set, but its preview is currently unavailable.'
                    : 'No logo uploaded yet.'}
                </p>
              </div>
            )}
          </div>

          {school.logo.updatedAt && (
            <p className="mt-2 text-xs text-brand-muted">
              Updated {formatDate(school.logo.updatedAt)}
            </p>
          )}

          {!school.logo.storageAvailable && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900">
              Logo storage is not configured for this environment, so uploads
              and removals are unavailable. The rest of the profile still works.
            </p>
          )}

          {canManage && (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="school-logo" className={labelClasses}>
                  Choose an image
                </label>
                <input
                  ref={logoInput}
                  id="school-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange}
                  disabled={logoBusy || !school.logo.storageAvailable}
                  className="block w-full text-sm text-brand-muted file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-blue disabled:cursor-not-allowed"
                />
                <p className={helpClasses}>
                  The new image is verified by the server before it replaces the
                  current one.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleLogoUpload()
                  }}
                  disabled={
                    !logoFile ||
                    logoBusy ||
                    !school.logo.storageAvailable
                  }
                  className={primaryButtonClasses}
                >
                  {logoBusy ? (
                    <LoaderCircle
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {logoBusy ? 'Uploading…' : 'Upload logo'}
                </button>

                {overview.setup.optional.logo && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleLogoRemove()
                    }}
                    disabled={logoBusy}
                    className={dangerButtonClasses}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove logo
                  </button>
                )}
              </div>

              <p className="text-xs leading-5 text-brand-muted">
                Uploads go directly to private storage; only a short-lived
                preview link is shown here.
              </p>
            </div>
          )}

          {!canManage && (
            <p className={`${secondaryButtonClasses} mt-4 cursor-default`}>
              Read-only
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
