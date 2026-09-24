/**
 * Shared SSE-over-fetch reader.
 *
 * Uses `fetch` + `ReadableStream` instead of `EventSource` because
 * `EventSource` cannot send an `Authorization` header, and every streaming
 * endpoint here requires one. Applies the same one-time refresh-on-401 logic
 * as api.ts, checked before the body is read.
 */
import { API_BASE, buildAuthHeaders, refreshAccessToken, AuthError } from './api'

export type SSEEventHandler = (event: string, data: string) => void

function postStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers = buildAuthHeaders(true)
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
}

function emitRecord(record: string, onEvent: SSEEventHandler): void {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length > 0) onEvent(event, dataLines.join('\n'))
}

async function readStream(res: Response, onEvent: SSEEventHandler): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // The real server emits CRLF line endings (`\r\n`, record separator
    // `\r\n\r\n`) -- normalize on the whole buffer (not just the new chunk)
    // so a `\r`/`\n` pair split across two network chunks still gets caught
    // once both halves have arrived.
    buffer = buffer.replace(/\r\n/g, '\n')

    let sepIndex: number
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      if (record.trim()) emitRecord(record, onEvent)
    }
  }
  if (buffer.trim()) emitRecord(buffer, onEvent)
}

export async function streamSSE(
  path: string,
  body: unknown,
  onEvent: SSEEventHandler,
  signal?: AbortSignal,
): Promise<void> {
  let res = await postStream(path, body, signal)

  if (res.status === 401) {
    try {
      await refreshAccessToken()
    } catch {
      throw new AuthError()
    }
    res = await postStream(path, body, signal)
  }

  if (!res.ok) {
    throw new Error(`Stream request failed (${res.status})`)
  }

  return readStream(res, onEvent)
}
