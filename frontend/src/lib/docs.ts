/**
 * Docs API: list/delete for RAG documents mirror the keys.ts/mcpServers.ts
 * apiFetch style. Upload is multipart, which apiFetch can't do (it hardcodes
 * JSON Content-Type — see api.ts's buildAuthHeaders) — so uploadDocument makes
 * its own fetch call, reusing api.ts's base URL, bearer token, error shape and
 * 401-refresh-retry building blocks instead of duplicating that logic.
 */
import { API_BASE, ApiError, AuthError, apiFetch, getAccessToken, refreshAccessToken } from './api'

// Mirrors app/modules/docs/models.py's DocumentStatus enum values exactly.
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface Document {
  id: string
  filename: string
  content_type: string
  status: DocumentStatus
  error_message: string | null
  created_at: string
}

export function listDocuments(): Promise<Document[]> {
  return apiFetch<Document[]>('/api/v1/docs')
}

export function deleteDocument(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/docs/${id}`, { method: 'DELETE' })
}

function postFile(file: File): Promise<Response> {
  const form = new FormData()
  form.append('file', file)
  const headers = new Headers()
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  // No Content-Type set here -- the browser fills in multipart/form-data with
  // the correct boundary itself; setting it manually would break the boundary.
  return fetch(`${API_BASE}/api/v1/docs`, { method: 'POST', headers, body: form })
}

export async function uploadDocument(file: File): Promise<Document> {
  let res = await postFile(file)

  if (res.status === 401) {
    try {
      await refreshAccessToken()
    } catch {
      throw new AuthError()
    }
    res = await postFile(file)
  }

  if (!res.ok) {
    let message = res.statusText || 'Failed to upload document'
    try {
      const body = (await res.json()) as { detail?: string }
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // No/invalid JSON body -- fall back to statusText above.
    }
    throw new ApiError(res.status, [{ message }])
  }

  return (await res.json()) as Document
}
