import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import { Login } from './Login'

const mockLogin = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: mockLogin,
    signup: vi.fn(),
    logout: vi.fn(),
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText(/email/i), email)
  await userEvent.type(screen.getByLabelText(/password/i), password)
  await userEvent.click(screen.getByRole('button', { name: /log in/i }))
}

describe('Login', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockNavigate.mockReset()
  })

  it('renders email and password fields', () => {
    renderLogin()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('shows a field-level error on a 422 validation failure', async () => {
    mockLogin.mockRejectedValueOnce(
      new ApiError(422, [{ field: 'email', message: 'value is not a valid email address' }]),
    )
    renderLogin()

    await fillAndSubmit('bad', 'password123')

    expect(await screen.findByText(/not a valid email/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a general error banner on a 401 (bad credentials)', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError(401, [{ message: 'Invalid email or password' }]))
    renderLogin()

    await fillAndSubmit('a@b.com', 'password123')

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i)
  })

  it('shows a friendly rate-limit message on a 429', async () => {
    mockLogin.mockRejectedValueOnce(
      new ApiError(429, [{ message: 'Too many attempts. Please wait a moment and try again.' }]),
    )
    renderLogin()

    await fillAndSubmit('a@b.com', 'password123')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/too many attempts/i)
  })

  it('redirects to / on success', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderLogin()

    await fillAndSubmit('a@b.com', 'password123')

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
