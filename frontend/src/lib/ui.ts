/** Shared Tailwind fragments so every management screen matches the Phase A UI. */

export const inputClasses =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-brand-muted'

export const labelClasses = 'mb-1.5 block text-sm font-medium text-brand-ink'

export const helpClasses = 'mt-1.5 text-xs leading-5 text-brand-muted'

export const errorTextClasses = 'mt-1.5 text-sm leading-6 text-red-700'

export const primaryButtonClasses =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-60'

export const secondaryButtonClasses =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50'

export const dangerButtonClasses =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50'

export const cardClasses =
  'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'

export const linkClasses =
  'font-medium text-brand-navy underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue'

export const pageTitleClasses =
  'text-2xl font-bold tracking-tight text-brand-navy sm:text-3xl'

export const pageSubtitleClasses = 'mt-1.5 text-sm leading-6 text-brand-muted'

export function statusBadgeClasses(status: 'active' | 'archived'): string {
  return status === 'active'
    ? 'rounded-full bg-brand-green/15 px-2.5 py-1 text-xs font-semibold text-brand-navy'
    : 'rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-brand-muted'
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(date)
}
