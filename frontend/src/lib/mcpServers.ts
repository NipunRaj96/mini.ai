/**
 * MCP servers API: CRUD, used by the agent console's MCP picker and the
 * Settings page's MCP Servers section. Thin apiFetch wrappers, no extra
 * state/caching here, mirroring agents.ts's style.
 */
import { apiFetch } from './api'

export interface McpServer {
  id: string
  name: string
  connection_url: string
  has_token: boolean
  is_active: boolean
  created_at: string
}

export function listMcpServers(): Promise<McpServer[]> {
  return apiFetch<McpServer[]>('/api/v1/mcp-servers')
}

export function addMcpServer(name: string, connectionUrl: string, token?: string): Promise<McpServer> {
  return apiFetch<McpServer>('/api/v1/mcp-servers', {
    method: 'POST',
    body: JSON.stringify({ name, connection_url: connectionUrl, token: token || undefined }),
  })
}

export function updateMcpServer(
  id: string,
  updates: Partial<{ name: string; connection_url: string; token: string; is_active: boolean }>,
): Promise<McpServer> {
  return apiFetch<McpServer>(`/api/v1/mcp-servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export function deleteMcpServer(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/mcp-servers/${id}`, { method: 'DELETE' })
}
