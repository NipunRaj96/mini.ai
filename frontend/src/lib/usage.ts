/**
 * Usage API: summary + per-event detail for the Settings page. Thin apiFetch
 * wrappers, no extra state/caching here, mirroring agents.ts's style.
 */
import { apiFetch } from './api'
import type { Provider } from './chat'

export interface UsageByProvider {
  provider: Provider
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface UsageSummary {
  total_input_tokens: number
  total_output_tokens: number
  estimated_cost_usd: number
  by_provider: UsageByProvider[]
}

export interface UsageEvent {
  id: string
  message_id: string | null
  conversation_id: string | null
  provider: Provider
  model: string
  cost_estimate_usd: number | null
  latency_ms: number
  created_at: string
}

export function getUsageSummary(): Promise<UsageSummary> {
  return apiFetch<UsageSummary>('/api/v1/usage/summary')
}

export function getUsageEvents(limit = 50, offset = 0): Promise<UsageEvent[]> {
  return apiFetch<UsageEvent[]>(`/api/v1/usage/events?limit=${limit}&offset=${offset}`)
}
