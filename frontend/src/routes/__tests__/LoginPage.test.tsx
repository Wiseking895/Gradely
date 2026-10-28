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

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>home screen</p>} />
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

  it('sends a verified user to the app', async () => {
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

    expect(await screen.findByText('home screen')).toBeInTheDocument()
  })

  it('links to public school registration', async () => {
    renderLogin()

    const link = await screen.findByRole('link', { name: /register your school/i })
    expect(link).toHaveAttribute('href', '/register-school')
  })
})
