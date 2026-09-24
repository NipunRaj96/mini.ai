/**
 * Provider keys API: CRUD for saved keys. Mirrors agents.ts's style — thin
 * apiFetch wrappers, no extra state/caching here. `listKeys`/`ApiKey`/`Provider`
 * already live in chat.ts (used by the chat composer) — re-exported here so
 * Settings.tsx has a single import surface for everything keys-related.
 */
import { apiFetch } from './api'
import { listKeys, type ApiKey, type Provider } from './chat'

export { listKeys }
export type { ApiKey, Provider }

export function addKey(provider: Provider, label: string, apiKey: string): Promise<ApiKey> {
  return apiFetch<ApiKey>('/api/v1/keys', {
    method: 'POST',
    body: JSON.stringify({ provider, label, api_key: apiKey }),
  })
}

export function setKeyActive(id: string, isActive: boolean): Promise<ApiKey> {
  return apiFetch<ApiKey>(`/api/v1/keys/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  })
}

export function deleteKey(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/keys/${id}`, { method: 'DELETE' })
}
