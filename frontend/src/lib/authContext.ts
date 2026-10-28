import { createContext, useContext } from 'react'
import { ApiError, type MembershipSummary, type SessionUser } from './api.ts'

/**
 * Shared auth context types and hook. Kept separate from the AuthProvider
 * component so each file exports a single kind of symbol (fast-refresh
 * friendly).
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthContextValue = {
  status: AuthStatus
  user: SessionUser | null
  memberships: MembershipSummary[]
  login: (email: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0
}
