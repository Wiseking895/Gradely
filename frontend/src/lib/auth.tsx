import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authApi, type MembershipSummary, type SessionUser } from './api.ts'
import { AuthContext, type AuthStatus } from './authContext.ts'

/**
 * Auth session state for the whole app.
 *
 * - On mount, asks the backend for the current session (HttpOnly cookie).
 * - `status` distinguishes loading / authenticated / anonymous so screens
 *   can render honest loading states instead of flashing the login form.
 * - Backend errors are treated as signed-out everywhere except during
 *   login, where they surface to the login form.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [memberships, setMemberships] = useState<MembershipSummary[]>([])

  useEffect(() => {
    let cancelled = false

    authApi
      .me()
      .then((data) => {
        if (cancelled) return
        setUser(data.user)
        setMemberships(data.memberships)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setMemberships([])
        setStatus('anonymous')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    setUser(data.user)
    const me = await authApi.me().catch(() => null)
    setMemberships(me?.memberships ?? [])
    setStatus('authenticated')
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined)
    setUser(null)
    setMemberships([])
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({ status, user, memberships, login, logout }),
    [status, user, memberships, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
