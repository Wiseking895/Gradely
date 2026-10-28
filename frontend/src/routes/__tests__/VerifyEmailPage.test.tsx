import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from '../VerifyEmailPage.tsx'
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

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  )
}

const verifiedUser = {
  id: 'user-1',
  email: 'ada@bright.test',
  displayName: 'Ada Admin',
  isPlatformAdmin: false,
  emailVerified: true,
}

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redeems the token on arrival and confirms the account', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue({
      status: 'verified',
      user: verifiedUser,
    })

    renderPage('/verify-email?token=raw-token')

    expect(
      await screen.findByRole('heading', { name: /email verified/i }),
    ).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1)
    expect(authApi.verifyEmail).toHaveBeenCalledWith('raw-token')
    expect(screen.getByText(/ada@bright\.test/)).toBeInTheDocument()
  })

  it('shows the expired-token state and lets the user resend', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError('Verification link has expired', 400, { code: 'token_expired' }),
    )
    vi.mocked(authApi.resendVerification).mockResolvedValue({
      status: 'pending',
      message: 'sent',
    })

    renderPage('/verify-email?token=old-token')

    expect(
      await screen.findByRole('heading', { name: /this link has expired/i }),
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email address'), 'ada@bright.test')
    await user.click(screen.getByRole('button', { name: /resend link/i }))

    expect(
      await screen.findByText(/a new verification link has been sent/i),
    ).toBeInTheDocument()
    expect(authApi.resendVerification).toHaveBeenCalledWith('ada@bright.test')
  })

  it.each([
    ['token_used', /this link was already used/i],
    ['token_invalid', /this link is not valid/i],
  ])('renders a specific state for %s', async (code, heading) => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError('Cannot verify', 400, { code }),
    )

    renderPage('/verify-email?token=some-token')

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend link/i })).toBeInTheDocument()
  })

  it('does not call the API when no token is present', async () => {
    renderPage('/verify-email')

    expect(
      await screen.findByRole('heading', { name: /verify your email/i }),
    ).toBeInTheDocument()
    expect(authApi.verifyEmail).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /resend link/i })).toBeInTheDocument()
  })

  it('surfaces resend rate limiting with the retry delay', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError('Verification link has expired', 400, { code: 'token_expired' }),
    )
    vi.mocked(authApi.resendVerification).mockRejectedValue(
      new ApiError('Too many resend requests', 429, { retryAfterSeconds: 60 }),
    )

    renderPage('/verify-email?token=old-token')
    await screen.findByRole('heading', { name: /this link has expired/i })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email address'), 'ada@bright.test')
    await user.click(screen.getByRole('button', { name: /resend link/i }))

    expect(await screen.findByText(/wait 60 seconds/i)).toBeInTheDocument()
  })

  it('offers a retry after a network failure', async () => {
    vi.mocked(authApi.verifyEmail)
      .mockRejectedValueOnce(new ApiError('Could not reach the API server', 0))
      .mockResolvedValueOnce({ status: 'verified', user: verifiedUser })

    renderPage('/verify-email?token=raw-token')

    expect(
      await screen.findByRole('heading', { name: /couldn't verify your email/i }),
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(
      await screen.findByRole('heading', { name: /email verified/i }),
    ).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(2)
  })
})
