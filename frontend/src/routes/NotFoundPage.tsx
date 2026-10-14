import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/BrandMark.tsx'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-surface px-4 text-center">
      <BrandMark />
      <h1 className="mt-8 text-3xl font-bold text-brand-navy">Page not found</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-brand-muted">
        The page you are looking for does not exist or has not been built yet.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to home
      </Link>
    </div>
  )
}
