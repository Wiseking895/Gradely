import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '../LoginPage.tsx'
import { AuthProvider } from '../../lib/auth.tsx'
import { ApiError, authApi } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>()
  return {
    ...actual,
    authApi: {
      login: vi.fn(),
      logout: vi.fn(),
      me: vi.fn(),
      registerSchool: vi.fn(),
      verifyEmail: vi.fn(),
      resendVerification: vi.fn(),
    },
  }
})

function renderLogin(initialEntry = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>home screen</p>} />
          <Route path="/dashboard" element={<p>dashboard screen</p>} />
          <Route
            path="/dashboard/schools/:schoolId"
            element={<p>school dashboard</p>}
          />
          <Route path="/verify-email" element={<p>verification screen</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

async function signIn() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email address'), 'ada@bright.test')
  await user.type(screen.getByLabelText('Password'), 'Sup3r-Secret-Password!')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  return user
}

describe('LoginPage verification routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authApi.me).mockRejectedValue(
      new ApiError('Authentication required', 401),
    )
  })

  it('sends an unverified administrator to the verification screen', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'ada@bright.test',
        displayName: 'Ada Admin',
        isPlatformAdmin: false,
        emailVerified: false,
      },
      expiresAt: new Date().toISOString(),
    })

    renderLogin()
    await signIn()

    expect(await screen.findByText('verification screen')).toBeInTheDocument()
    expect(authApi.login).toHaveBeenCalledWith(
      'ada@bright.test',
      'Sup3r-Secret-Password!',
    )
  })

  it('sends a verified user to the dashboard', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'ada@bright.test',
        displayName: 'Ada Admin',
        isPlatformAdmin: false,
        emailVerified: true,
      },
      expiresAt: new Date().toISOString(),
    })

    renderLogin()
    await signIn()

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument()
  })

  it('returns a verified user to a safe internal returnTo path', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'ada@bright.test',
        displayName: 'Ada Admin',
        isPlatformAdmin: false,
        emailVerified: true,
      },
      expiresAt: new Date().toISOString(),
    })

    renderLogin(
      '/login?returnTo=%2Fdashboard%2Fschools%2F00000000-0000-4000-8000-000000000001',
    )
    await signIn()

    expect(await screen.findByText('school dashboard')).toBeInTheDocument()
  })

  it('rejects an external returnTo and falls back to the dashboard', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'ada@bright.test',
        displayName: 'Ada Admin',
        isPlatformAdmin: false,
        emailVerified: true,
      },
      expiresAt: new Date().toISOString(),
    })

    renderLogin('/login?returnTo=https%3A%2F%2Fevil.example%2Fphish')
    await signIn()

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument()
  })

  it('links to public school registration', async () => {
    renderLogin()

    const link = await screen.findByRole('link', { name: /register your school/i })
    expect(link).toHaveAttribute('href', '/register-school')
  })
})
