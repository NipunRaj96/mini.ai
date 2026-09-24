import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas">
      <p className="font-body text-sm text-on-surface-mid">Loading…</p>
    </main>
  )
}

/** Redirects to /login unless a session is active. Holds off during the
 * session-restore-on-mount window (auth.ts's isLoading) instead of flashing
 * the login page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

/** Redirects already-signed-in users away from /login and /signup. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <LoadingScreen />
  if (isAuthenticated) return <Navigate to="/" replace />
  return children
}
