import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, setTokens } from './api'
import { createConversation } from './chat'

describe('createConversation', () => {
  beforeEach(() => {
    localStorage.clear()
    setTokens({ access_token: 'good-token', refresh_token: 'good-refresh' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearTokens()
  })

  it('synthesizes updated_at from created_at (the POST endpoint response has no updated_at field)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'c1', title: null, created_at: '2026-09-20T12:00:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const conv = await createConversation()

    expect(conv).toEqual({ id: 'c1', title: null, updated_at: '2026-09-20T12:00:00Z' })
  })
})
