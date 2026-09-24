/**
 * Typed fetch wrapper for the FastAPI backend.
 *
 * - Injects the bearer access token when one is held.
 * - On a 401 from a protected endpoint, attempts exactly one silent refresh
 *   via /api/v1/auth/refresh, then retries the original request once. If the
 *   refresh itself fails, tokens are cleared and an AuthError is thrown so
 *   calling code can redirect to /login. Never loops.
 * - Normalizes pydantic's 422 `{"detail": [...]}` shape into `{field, message}[]`.
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const REFRESH_STORAGE_KEY = 'mini_ai_refresh_token'

// Access token intentionally lives only in module memory — it does not
// survive a hard refresh. The refresh token is the durable credential.
let accessToken: string | null = null

export interface TokenPair {
  access_token: string
  refresh_token: string
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_STORAGE_KEY)
}

export function setTokens(tokens: TokenPair): void {
  accessToken = tokens.access_token
  localStorage.setItem(REFRESH_STORAGE_KEY, tokens.refresh_token)
}

export function clearTokens(): void {
  accessToken = null
  localStorage.removeItem(REFRESH_STORAGE_KEY)
}

export interface ApiFieldError {
  field?: string
  message: string
}

/** A non-2xx response from the API, with normalized field-level errors when available. */
export class ApiError extends Error {
  status: number
  errors: ApiFieldError[]

  constructor(status: number, errors: ApiFieldError[]) {
    super(errors[0]?.message ?? `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

/** Session could not be refreshed — caller should redirect to /login. */
export class AuthError extends Error {
  constructor(message = 'Your session has expired. Please log in again.') {
    super(message)
    this.name = 'AuthError'
  }
}

function isAuthEndpoint(path: string): boolean {
  return path.includes('/auth/login') || path.includes('/auth/refresh')
}

async function parseErrorBody(res: Response): Promise<ApiFieldError[]> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return [{ message: res.statusText || 'Something went wrong' }]
  }

  const detail = (body as { detail?: unknown } | null)?.detail
  if (Array.isArray(detail)) {
    // pydantic validation error shape: [{type, loc, msg, ...}]
    return detail.map((d) => ({
      field: Array.isArray(d?.loc) ? String(d.loc[d.loc.length - 1]) : undefined,
      message: typeof d?.msg === 'string' ? d.msg : 'Invalid value',
    }))
  }
  if (typeof detail === 'string') {
    return [{ message: detail }]
  }
  return [{ message: 'Something went wrong' }]
}

export function buildAuthHeaders(hasBody: boolean): Headers {
  const headers = new Headers()
  if (hasBody) headers.set('Content-Type', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

// Dedupes concurrent refreshes (e.g. api.ts and sse.ts both 401 at once) so
// only one refresh request is ever in flight, and a single-use rotating
// refresh token isn't burned twice.
let refreshPromise: Promise<string> | null = null

async function performRefresh(): Promise<string> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new AuthError()

  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) {
    clearTokens()
    throw new AuthError()
  }
  const tokens = (await res.json()) as TokenPair
  setTokens(tokens)
  return tokens.access_token
}

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    if (res.status === 429) {
      throw new ApiError(429, [{ message: 'Too many attempts. Please wait a moment and try again.' }])
    }
    throw new ApiError(res.status, await parseErrorBody(res))
  }
  return (await res.json()) as T
}

function doFetch(path: string, options: RequestInit): Promise<Response> {
  const headers = buildAuthHeaders(options.body != null)
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await doFetch(path, options)

  if (res.status === 401 && !isAuthEndpoint(path)) {
    try {
      await refreshAccessToken()
    } catch {
      throw new AuthError()
    }
    const retryRes = await doFetch(path, options)
    return handleResponse<T>(retryRes)
  }

  return handleResponse<T>(res)
}
