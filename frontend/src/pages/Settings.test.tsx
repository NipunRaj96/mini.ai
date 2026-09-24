import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../lib/api'
import { Settings } from './Settings'

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
  API_BASE: 'http://localhost:8000',
  getAccessToken: () => 'test-token',
  refreshAccessToken: vi.fn(),
  AuthError: class AuthError extends Error {},
  ApiError: class ApiError extends Error {
    status: number
    errors: { field?: string; message: string }[]
    constructor(status: number, errors: { field?: string; message: string }[] = [{ message: 'error' }]) {
      super(errors[0]?.message ?? `Request failed (${status})`)
      this.status = status
      this.errors = errors
    }
  },
}))

const mockApiFetch = vi.mocked(apiFetch)
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  )
}

const keys = [
  { id: 'k1', provider: 'openai', label: 'My OpenAI', masked_key: '***1234', is_active: true, created_at: 't' },
]

const mcpServers = [
  { id: 'm1', name: 'search-mcp', connection_url: 'https://x', has_token: true, is_active: true, created_at: 't' },
]

const usageSummary = {
  total_input_tokens: 1000,
  total_output_tokens: 500,
  estimated_cost_usd: 0.0042,
  by_provider: [{ provider: 'openai', input_tokens: 1000, output_tokens: 500, estimated_cost_usd: 0.0042 }],
}

const usageEvents = [
  {
    id: 'e1',
    message_id: 'msg1',
    conversation_id: 'c1',
    provider: 'openai',
    model: 'gpt-4o',
    cost_estimate_usd: 0.0012,
    latency_ms: 850,
    created_at: '2026-01-01T00:00:00Z',
  },
]

const memories = [
  { id: 'mem1', content: 'Likes dark mode', source: 'manual', created_at: 't' },
  { id: 'mem2', content: 'Works in fintech', source: 'auto', created_at: 't' },
]

const memorySettings = { enabled: true }

function routeApiFetch(impl: (path: string, options?: RequestInit) => unknown) {
  mockApiFetch.mockImplementation(async (path: string, options?: RequestInit) => impl(path, options))
}

function withDefaultRoutes(extra?: (path: string, options?: RequestInit) => unknown) {
  routeApiFetch((path, options) => {
    if (path === '/api/v1/keys' && (!options || options.method === undefined)) return keys
    if (path === '/api/v1/mcp-servers' && (!options || options.method === undefined)) return mcpServers
    if (path === '/api/v1/usage/summary') return usageSummary
    if (path.startsWith('/api/v1/usage/events')) return usageEvents
    if (path === '/api/v1/memory' && (!options || options.method === undefined)) return memories
    if (path === '/api/v1/memory/settings' && (!options || options.method === undefined)) return memorySettings
    if (extra) return extra(path, options)
    throw new Error(`unexpected call: ${path} ${options?.method ?? 'GET'}`)
  })
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockFetch.mockReset()
})

describe('Settings sections render', () => {
  it('renders provider keys, MCP servers, and usage data', async () => {
    withDefaultRoutes()
    renderSettings()

    expect(await screen.findByText('My OpenAI')).toBeInTheDocument()
    expect(screen.getByText('***1234')).toBeInTheDocument()
    expect(screen.getByText('search-mcp')).toBeInTheDocument()
    expect(screen.getByText('Token set')).toBeInTheDocument()
    expect(await screen.findByText('Estimated Cost')).toBeInTheDocument()
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('500').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$0.0042').length).toBeGreaterThan(0)
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
  })

  it("one section's fetch failure does not blank the others", async () => {
    withDefaultRoutes((path) => {
      if (path === '/api/v1/mcp-servers') throw new Error('server error')
      throw new Error(`unexpected call: ${path}`)
    })
    renderSettings()

    expect(await screen.findByText('My OpenAI')).toBeInTheDocument()
    expect(await screen.findByText('Estimated Cost')).toBeInTheDocument()
  })
})

describe('Provider Keys', () => {
  it('add-key form posts the correct body and adds it to the list', async () => {
    let posted: unknown = null
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/keys' && options?.method === 'POST') {
        posted = JSON.parse(options.body as string)
        return { id: 'k2', provider: 'anthropic', label: 'New Key', masked_key: '***9999', is_active: true, created_at: 't' }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('My OpenAI')
    await user.click(screen.getByRole('button', { name: /\+ add key/i }))
    await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic')
    await user.type(screen.getByLabelText('Label'), 'New Key')
    await user.type(screen.getByLabelText('API Key'), 'sk-secret')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(posted).toEqual({ provider: 'anthropic', label: 'New Key', api_key: 'sk-secret' }))
    expect(await screen.findByText('New Key')).toBeInTheDocument()
  })

  it('toggles key active state via PATCH with the correct body', async () => {
    let patched: unknown = null
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/keys/k1' && options?.method === 'PATCH') {
        patched = JSON.parse(options.body as string)
        return { ...keys[0], is_active: false }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('My OpenAI')
    const keyRow = screen.getByText('My OpenAI').closest('li') as HTMLElement
    await user.click(within(keyRow).getByRole('button', { name: /deactivate/i }))

    await waitFor(() => expect(patched).toEqual({ is_active: false }))
    expect(await within(keyRow).findByRole('button', { name: /activate/i })).toBeInTheDocument()
  })

  it('deletes a key after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/keys/k1' && options?.method === 'DELETE') return undefined
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('My OpenAI')
    await user.click(screen.getByLabelText('Delete My OpenAI'))

    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('shows an error banner and keeps the key listed when delete fails', async () => {
    const { ApiError } = await import('../lib/api')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/keys/k1' && options?.method === 'DELETE') {
        throw new ApiError(500, [{ message: 'Failed to delete key. Please try again.' }])
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('My OpenAI')
    await user.click(screen.getByLabelText('Delete My OpenAI'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete key')
    expect(screen.getByText('My OpenAI')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

describe('MCP Servers', () => {
  it('add-server form posts the correct body and adds it to the list', async () => {
    let posted: unknown = null
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/mcp-servers' && options?.method === 'POST') {
        posted = JSON.parse(options.body as string)
        return { id: 'm2', name: 'New MCP', connection_url: 'https://new', has_token: false, is_active: true, created_at: 't' }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('search-mcp')
    await user.click(screen.getByRole('button', { name: /\+ add mcp server/i }))
    await user.type(screen.getByLabelText('Name'), 'New MCP')
    await user.type(screen.getByLabelText('Connection URL'), 'https://new')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(posted).toEqual({ name: 'New MCP', connection_url: 'https://new', token: undefined }),
    )
    expect(await screen.findByText('New MCP')).toBeInTheDocument()
  })

  it('shows an error banner and keeps the server listed when delete fails', async () => {
    const { ApiError } = await import('../lib/api')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/mcp-servers/m1' && options?.method === 'DELETE') {
        throw new ApiError(500, [{ message: 'Failed to delete server. Please try again.' }])
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('search-mcp')
    await user.click(screen.getByLabelText('Delete search-mcp'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete server')
    expect(screen.getByText('search-mcp')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

describe('Memory', () => {
  it('renders the memory list with source badges and the initial toggle state', async () => {
    withDefaultRoutes()
    renderSettings()

    expect(await screen.findByText('Likes dark mode')).toBeInTheDocument()
    expect(screen.getByText('Works in fintech')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: /remember things about me/i })
    expect(checkbox).toBeChecked()
  })

  it('add-memory form posts the correct body and adds it to the list', async () => {
    let posted: unknown = null
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/memory' && options?.method === 'POST') {
        posted = JSON.parse(options.body as string)
        return { id: 'mem3', content: 'New fact', source: 'manual', created_at: 't' }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Likes dark mode')
    await user.click(screen.getByRole('button', { name: /\+ add memory/i }))
    await user.type(screen.getByLabelText('Memory'), 'New fact')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(posted).toEqual({ content: 'New fact' }))
    expect(await screen.findByText('New fact')).toBeInTheDocument()
  })

  it('shows an error banner and keeps the memory listed when delete fails', async () => {
    const { ApiError } = await import('../lib/api')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/memory/mem1' && options?.method === 'DELETE') {
        throw new ApiError(500, [{ message: 'Failed to delete memory. Please try again.' }])
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Likes dark mode')
    await user.click(screen.getByLabelText('Delete memory: Likes dark mode'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete memory')
    expect(screen.getByText('Likes dark mode')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('toggles memory setting via PATCH with the correct body', async () => {
    let patched: unknown = null
    withDefaultRoutes((path, options) => {
      if (path === '/api/v1/memory/settings' && options?.method === 'PATCH') {
        patched = JSON.parse(options.body as string)
        return { enabled: false }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Likes dark mode')
    const checkbox = screen.getByRole('checkbox', { name: /remember things about me/i })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)

    await waitFor(() => expect(patched).toEqual({ enabled: false }))
    expect(checkbox).not.toBeChecked()
  })
})
