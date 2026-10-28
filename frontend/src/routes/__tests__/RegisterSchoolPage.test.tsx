import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterSchoolPage from '../RegisterSchoolPage.tsx'
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

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterSchoolPage />
    </MemoryRouter>,
  )
}

async function fillValidForm() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('School name'), 'Bright Future Academy')
  await user.type(screen.getByLabelText('Your full name'), 'Ada Admin')
  await user.type(screen.getByLabelText('Email address'), 'ADA@Bright.Test')
  await user.type(screen.getByLabelText('Password'), 'Sup3r-Secret-Password!')
  await user.type(
    screen.getByLabelText('Confirm password'),
    'Sup3r-Secret-Password!',
  )
  return user
}

describe('RegisterSchoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates required fields without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /create school account/i }))

    expect(await screen.findByText(/school name must be/i)).toBeInTheDocument()
    expect(authApi.registerSchool).not.toHaveBeenCalled()
  })

  it('registers a school, normalizes the email and offers a resend action', async () => {
    vi.mocked(authApi.registerSchool).mockResolvedValue({
      status: 'verification_sent',
      user: {
        id: 'user-1',
        email: 'ada@bright.test',
        displayName: 'Ada Admin',
        isPlatformAdmin: false,
        emailVerified: false,
      },
      school: { id: 'school-1', name: 'Bright Future Academy', slug: 'bright-future-academy' },
    })
    vi.mocked(authApi.resendVerification).mockResolvedValue({
      status: 'pending',
      message: 'sent',
    })

    renderPage()
    const user = await fillValidForm()

    const slugInput = screen.getByLabelText('School identifier')
    expect(slugInput).toHaveValue('bright-future-academy')

    await user.click(screen.getByRole('button', { name: /create school account/i }))

    expect(
      await screen.findByRole('heading', { name: /check your email/i }),
    ).toBeInTheDocument()
    expect(authApi.registerSchool).toHaveBeenCalledWith({
      schoolName: 'Bright Future Academy',
      schoolSlug: 'bright-future-academy',
      adminName: 'Ada Admin',
      email: 'ada@bright.test',
      password: 'Sup3r-Secret-Password!',
    })
    expect(screen.getByText('ada@bright.test')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /resend link/i }))
    expect(await screen.findByText(/a new verification link has been sent/i)).toBeInTheDocument()
    expect(authApi.resendVerification).toHaveBeenCalledWith('ada@bright.test')
  })

  it('shows a field error when the email is already registered', async () => {
    vi.mocked(authApi.registerSchool).mockRejectedValue(
      new ApiError('Email already registered', 409, { code: 'email_taken' }),
    )

    renderPage()
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create school account/i }))

    expect(
      await screen.findByText(/an account with this email already exists/i),
    ).toBeInTheDocument()
  })

  it('shows a field error when the school identifier is taken', async () => {
    vi.mocked(authApi.registerSchool).mockRejectedValue(
      new ApiError('School identifier already in use', 409, {
        code: 'school_identifier_taken',
      }),
    )

    renderPage()
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create school account/i }))

    expect(
      await screen.findByText(/that school identifier is taken/i),
    ).toBeInTheDocument()
  })

  it('keeps the account but offers a resend when email delivery fails', async () => {
    vi.mocked(authApi.registerSchool).mockRejectedValue(
      new ApiError('Verification email could not be sent', 502, {
        code: 'email_delivery_failed',
      }),
    )

    renderPage()
    const user = await fillValidForm()
    await user.click(screen.getByRole('button', { name: /create school account/i }))

    expect(
      await screen.findByRole('heading', { name: /verification email not sent/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend link/i })).toBeInTheDocument()
  })
})
