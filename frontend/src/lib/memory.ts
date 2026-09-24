/**
 * Memory API: manual/auto memory entries + master on/off setting. Thin
 * apiFetch wrappers, no extra state/caching here, mirroring usage.ts's style.
 */
import { apiFetch } from './api'

export interface Memory {
  id: string
  content: string
  source: 'manual' | 'auto'
  created_at: string
}

export interface MemorySettings {
  enabled: boolean
}

export function listMemories(): Promise<Memory[]> {
  return apiFetch<Memory[]>('/api/v1/memory')
}

export function addMemory(content: string): Promise<Memory> {
  return apiFetch<Memory>('/api/v1/memory', {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export function deleteMemory(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/memory/${id}`, { method: 'DELETE' })
}

export function getMemorySettings(): Promise<MemorySettings> {
  return apiFetch<MemorySettings>('/api/v1/memory/settings')
}

export function updateMemorySettings(enabled: boolean): Promise<MemorySettings> {
  return apiFetch<MemorySettings>('/api/v1/memory/settings', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}
