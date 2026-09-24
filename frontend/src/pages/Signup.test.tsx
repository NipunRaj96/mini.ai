import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { Signup } from './Signup'

const mockSignup = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    signup: mockSignup,
    logout: vi.fn(),
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderSignup() {
  return render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  )
}

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText(/email/i), email)
  await userEvent.type(screen.getByLabelText(/password/i), password)
  await userEvent.click(screen.getByRole('button', { name: /sign up/i }))
}

describe('Signup', () => {
  beforeEach(() => {
    mockSignup.mockReset()
    mockNavigate.mockReset()
  })

  it('renders email and password fields', () => {
    renderSignup()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('rejects a password under 8 characters client-side, without calling the API', async () => {
    renderSignup()

    await fillAndSubmit('a@b.com', 'short')

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(mockSignup).not.toHaveBeenCalled()
  })

  it('still surfaces the server 422 as the source of truth', async () => {
    mockSignup.mockRejectedValueOnce(
      new ApiError(422, [{ field: 'password', message: 'Password is too weak' }]),
    )
    renderSignup()

    await fillAndSubmit('a@b.com', 'password123')

    expect(await screen.findByText(/too weak/i)).toBeInTheDocument()
  })

  it('shows a general error banner on a 401', async () => {
    mockSignup.mockRejectedValueOnce(new ApiError(401, [{ message: 'Something went wrong' }]))
    renderSignup()

    await fillAndSubmit('a@b.com', 'password123')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shows a friendly rate-limit message on a 429', async () => {
    mockSignup.mockRejectedValueOnce(
      new ApiError(429, [{ message: 'Too many attempts. Please wait a moment and try again.' }]),
    )
    renderSignup()

    await fillAndSubmit('a@b.com', 'password123')

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
  })

  it('redirects to / on success', async () => {
    mockSignup.mockResolvedValueOnce(undefined)
    renderSignup()

    await fillAndSubmit('a@b.com', 'password123')

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
