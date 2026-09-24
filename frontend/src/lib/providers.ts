/**
 * Providers API: live model listing for a given provider's active key.
 * Thin apiFetch wrapper, mirrors agents.ts/usage.ts's style.
 */
import { apiFetch } from './api'
import type { Provider } from './chat'

export interface ModelInfo {
  id: string
  display_name: string
  context_window: number | null
}

export function listModels(provider: Provider): Promise<ModelInfo[]> {
  return apiFetch<ModelInfo[]>(`/api/v1/providers/${provider}/models`)
}
