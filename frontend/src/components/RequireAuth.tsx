import { LoaderCircle } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/authContext.ts'
import { loginPathFor } from '../lib/navigation.ts'

/**
 * Client-side route guard for authenticated school management.
 *
 * The backend remains the authority; this only avoids rendering management
 * screens for anonymous or unverified users and preserves the requested path
 * across sign-in.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-surface px-4">
        <p
          className="flex items-center gap-2 text-sm text-brand-muted"
          aria-live="polite"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking your session…
        </p>
      </div>
    )
  }

  if (status === 'anonymous' || !user) {
    return (
      <Navigate
        to={loginPathFor(`${location.pathname}${location.search}`)}
        replace
      />
    )
  }

  if (!user.emailVerified) {
    return <Navigate to="/verify-email" replace />
  }

  return children
}
