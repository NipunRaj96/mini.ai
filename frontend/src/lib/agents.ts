/**
 * Agents API: CRUD for saved agents. Mirrors chat.ts's style — thin
 * apiFetch wrappers, no extra state/caching here.
 */
import { apiFetch } from './api'

export type OutputFormat = 'structured_markdown' | 'strict_json' | 'executive_brief' | 'custom'

export interface Agent {
  id: string
  name: string
  role: string
  primary_goal: string
  output_format: OutputFormat
  output_instructions: string | null
  json_schema: object | null
  guardrail_patterns: string[]
  allowed_tools: string[]
  mcp_server_ids: string[]
  is_deployed: boolean
  created_at: string
  updated_at: string
}

export interface AgentInput {
  name: string
  role: string
  primary_goal: string
  output_format: OutputFormat
  output_instructions?: string | null
  json_schema?: object | null
  guardrail_patterns?: string[]
  allowed_tools?: string[]
  mcp_server_ids?: string[]
  is_deployed?: boolean
}

export function listAgents(): Promise<Agent[]> {
  return apiFetch<Agent[]>('/api/v1/agents')
}

export function createAgent(input: AgentInput): Promise<Agent> {
  return apiFetch<Agent>('/api/v1/agents', { method: 'POST', body: JSON.stringify(input) })
}

export function updateAgent(id: string, input: Partial<AgentInput>): Promise<Agent> {
  return apiFetch<Agent>(`/api/v1/agents/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteAgent(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/agents/${id}`, { method: 'DELETE' })
}
