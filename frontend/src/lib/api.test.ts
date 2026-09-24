import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, clearTokens, setTokens, AuthError, ApiError, getAccessToken } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries once after a silent refresh on 401, then succeeds', async () => {
    setTokens({ access_token: 'expired-token', refresh_token: 'valid-refresh' })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // 1. original request -> 401
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      // 2. refresh call -> new tokens
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-token', refresh_token: 'new-refresh' }))
      // 3. retried original request -> success
      .mockResolvedValueOnce(jsonResponse(200, { id: '1', email: 'a@b.com' }))

    const result = await apiFetch<{ id: string; email: string }>('/api/v1/auth/me')

    expect(result).toEqual({ id: '1', email: 'a@b.com' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getAccessToken()).toBe('new-token')

    // The retried call carries the newly refreshed bearer token.
    const retryCall = fetchMock.mock.calls[2]
    const retryHeaders = new Headers(retryCall[1]?.headers)
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-token')
  })

  it('clears tokens and throws AuthError when refresh itself fails, without looping', async () => {
    setTokens({ access_token: 'expired-token', refresh_token: 'bad-refresh' })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // 1. original request -> 401
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      // 2. refresh call -> also fails
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'invalid refresh token' }))

    await expect(apiFetch('/api/v1/auth/me')).rejects.toBeInstanceOf(AuthError)

    // Exactly the original request + one refresh attempt — no retry loop.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('mini_ai_refresh_token')).toBeNull()
  })

  it('does not attempt a refresh for a 401 from /auth/login itself', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(401, { detail: 'bad credentials' }))

    await expect(apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes the pydantic 422 detail array into field/message pairs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(422, {
        detail: [{ type: 'value_error', loc: ['body', 'password'], msg: 'String should have at least 8 characters' }],
      }),
    )

    try {
      await apiFetch('/api/v1/auth/signup', { method: 'POST', body: '{}' })
      expect.unreachable('expected apiFetch to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(422)
      expect(apiErr.errors).toEqual([{ field: 'password', message: 'String should have at least 8 characters' }])
    }
  })

  it('surfaces a friendly message on 429 rate limiting', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(429, { detail: 'Too Many Requests' }))

    await expect(apiFetch('/api/v1/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('Too many attempts'),
    })
  })
})
