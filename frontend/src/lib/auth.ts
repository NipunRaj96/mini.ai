/**
 * Token-backed auth state: a thin React context around api.ts's login/signup/
 * logout/me calls and token storage. No routing here — that's Task 2's guard
 * component; this just answers "who is signed in" and exposes the actions.
 */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch, clearTokens, getRefreshToken, setTokens, type TokenPair } from './api'

export interface User {
  id: string
  email: string
  created_at: string
}

export interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function establishSession(tokens: TokenPair): Promise<User> {
  setTokens(tokens)
  return apiFetch<User>('/api/v1/auth/me')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // The access token lives only in memory, so a hard refresh loses it.
    // If a refresh token survived in localStorage, use it to restore the
    // session instead of forcing a re-login on every page load.
    const existingRefreshToken = getRefreshToken()
    if (!existingRefreshToken) {
      setIsLoading(false)
      return
    }
    apiFetch<TokenPair>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: existingRefreshToken }),
    })
      .then(establishSession)
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setIsLoading(false))
  }, [])

  async function login(email: string, password: string) {
    const tokens = await apiFetch<TokenPair>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setUser(await establishSession(tokens))
  }

  async function signup(email: string, password: string) {
    const tokens = await apiFetch<TokenPair>('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setUser(await establishSession(tokens))
  }

  async function logout() {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' })
    } finally {
      clearTokens()
      setUser(null)
    }
  }

  const value: AuthContextValue = {
    user,
    isAuthenticated: user != null,
    isLoading,
    login,
    signup,
    logout,
  }

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
