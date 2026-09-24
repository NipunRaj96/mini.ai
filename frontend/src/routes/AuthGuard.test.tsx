import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RequireAuth, RequireGuest } from './AuthGuard'

const mockUseAuth = vi.fn()

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth(),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/login"
          element={
            <RequireGuest>
              <div>Login page</div>
            </RequireGuest>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>Home page</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('route guards', () => {
  it('redirects unauthenticated access to a protected route to /login', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false })
    renderAt('/')
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('redirects authenticated access to /login to /', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })
    renderAt('/login')
    expect(screen.getByText('Home page')).toBeInTheDocument()
  })

  it('shows a loading state instead of redirecting while the session is still restoring', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true })
    renderAt('/')
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
    expect(screen.queryByText('Home page')).not.toBeInTheDocument()
  })
})
