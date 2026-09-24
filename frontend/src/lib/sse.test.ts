import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, setTokens } from './api'
import { streamSSE } from './sse'

function sseStreamResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('streamSSE', () => {
  beforeEach(() => {
    localStorage.clear()
    clearTokens()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a multi-event SSE body into onEvent calls', async () => {
    setTokens({ access_token: 'good-token', refresh_token: 'good-refresh' })

    const body =
      'event: delta\ndata: {"text":"Hel"}\n\n' +
      'event: delta\ndata: {"text":"lo"}\n\n' +
      'event: done\ndata: {"finish_reason":"stop"}\n\n'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(sseStreamResponse([body]))

    const events: Array<{ event: string; data: string }> = []
    await streamSSE('/api/v1/chat/conversations/1/messages', { content: 'hi' }, (event, data) => {
      events.push({ event, data })
    })

    expect(events).toEqual([
      { event: 'delta', data: '{"text":"Hel"}' },
      { event: 'delta', data: '{"text":"lo"}' },
      { event: 'done', data: '{"finish_reason":"stop"}' },
    ])
  })

  it('handles records split across multiple stream chunks', async () => {
    setTokens({ access_token: 'good-token', refresh_token: 'good-refresh' })

    // The blank-line terminator lands in a separate chunk from its data line.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      sseStreamResponse(['event: delta\ndata: {"text":"a"}', '\n\nevent: done\ndata: {}\n\n']),
    )

    const events: Array<{ event: string; data: string }> = []
    await streamSSE('/api/v1/chat/conversations/1/messages', { content: 'hi' }, (event, data) => {
      events.push({ event, data })
    })

    expect(events).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('parses CRLF-separated events, matching the real backend (sse-starlette emits \\r\\n)', async () => {
    setTokens({ access_token: 'good-token', refresh_token: 'good-refresh' })

    const body =
      'event: delta\r\ndata: {"text":"Hel"}\r\n\r\n' +
      'event: delta\r\ndata: {"text":"lo"}\r\n\r\n' +
      'event: done\r\ndata: {"finish_reason":"stop"}\r\n\r\n'

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(sseStreamResponse([body]))

    const events: Array<{ event: string; data: string }> = []
    await streamSSE('/api/v1/chat/conversations/1/messages', { content: 'hi' }, (event, data) => {
      events.push({ event, data })
    })

    expect(events).toEqual([
      { event: 'delta', data: '{"text":"Hel"}' },
      { event: 'delta', data: '{"text":"lo"}' },
      { event: 'done', data: '{"finish_reason":"stop"}' },
    ])
  })

  it('parses a CRLF record separator split exactly across two network chunks', async () => {
    setTokens({ access_token: 'good-token', refresh_token: 'good-refresh' })

    // Splits the "\r\n\r\n" boundary between events right down the middle --
    // the buffer-level (not per-chunk) CRLF normalization must still catch it.
    const chunks = ['event: delta\r\ndata: {"text":"a"}\r', '\n\r\nevent: done\r\ndata: {}\r\n\r\n']

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(sseStreamResponse(chunks))

    const events: Array<{ event: string; data: string }> = []
    await streamSSE('/api/v1/chat/conversations/1/messages', { content: 'hi' }, (event, data) => {
      events.push({ event, data })
    })

    expect(events).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('refreshes once on a 401 before streaming, then retries and streams', async () => {
    setTokens({ access_token: 'expired-token', refresh_token: 'valid-refresh' })

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-token', refresh_token: 'new-refresh' }))
      .mockResolvedValueOnce(sseStreamResponse(['event: done\ndata: {}\n\n']))

    const events: Array<{ event: string; data: string }> = []
    await streamSSE('/api/v1/chat/conversations/1/messages', { content: 'hi' }, (event, data) => {
      events.push({ event, data })
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(events).toEqual([{ event: 'done', data: '{}' }])

    const retryCall = fetchMock.mock.calls[2]
    const retryHeaders = new Headers(retryCall[1]?.headers)
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-token')
  })
})
