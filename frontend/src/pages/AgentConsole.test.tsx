import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../lib/api'
import { AgentConsole } from './AgentConsole'

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
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
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderConsole() {
  return render(
    <MemoryRouter>
      <AgentConsole />
    </MemoryRouter>,
  )
}

const draftAgent = {
  id: 'a1',
  name: 'Research Bot',
  role: 'Researcher',
  primary_goal: 'Find sources',
  output_format: 'structured_markdown',
  output_instructions: null,
  json_schema: null,
  guardrail_patterns: ['no medical advice', 'no legal advice'],
  allowed_tools: ['web_search'],
  mcp_server_ids: [],
  is_deployed: false,
  created_at: 't',
  updated_at: 't',
}

const deployedAgent = {
  ...draftAgent,
  id: 'a2',
  name: 'Live Agent',
  role: 'Support',
  is_deployed: true,
}

const activeKeys = [{ id: 'k1', provider: 'openai', label: 'k1', masked_key: '***1234', is_active: true, created_at: 't' }]
const mcpServers = [
  { id: 'm1', name: 'search-mcp', connection_url: 'https://x', has_token: true, is_active: true, created_at: 't' },
  { id: 'm2', name: 'docs-mcp', connection_url: 'https://y', has_token: false, is_active: true, created_at: 't' },
]

function routeApiFetch(impl: (path: string, options?: RequestInit) => unknown) {
  mockApiFetch.mockImplementation(async (path: string, options?: RequestInit) => impl(path, options))
}

function withDefaultRoutes(agents: unknown[], extra?: (path: string, options?: RequestInit) => unknown) {
  routeApiFetch((path, options) => {
    if (path === '/api/v1/agents' && (!options || options.method === undefined)) return agents
    if (path === '/api/v1/keys') return activeKeys
    if (path === '/api/v1/mcp-servers') return mcpServers
    if (extra) return extra(path, options)
    throw new Error(`unexpected call: ${path} ${options?.method ?? 'GET'}`)
  })
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockNavigate.mockReset()
})

describe('Page heading', () => {
  it('shows "Agent Console" as the page-title heading', async () => {
    withDefaultRoutes([draftAgent])
    renderConsole()

    expect(await screen.findByRole('heading', { name: 'Agent Console' })).toBeInTheDocument()
  })
})

describe('Back to chat button', () => {
  const originalState = window.history.state

  afterEach(() => {
    Object.defineProperty(window.history, 'state', { value: originalState, configurable: true, writable: true })
  })

  it('goes back in browser history when a prior in-app entry exists', async () => {
    withDefaultRoutes([draftAgent])
    Object.defineProperty(window.history, 'state', { value: { idx: 2 }, configurable: true, writable: true })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /back to chat/i }))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('falls back to navigating home when there is no prior history entry (e.g. a direct link/refresh)', async () => {
    withDefaultRoutes([draftAgent])
    Object.defineProperty(window.history, 'state', { value: { idx: 0 }, configurable: true, writable: true })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /back to chat/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('falls back to navigating home when history state has no idx at all', async () => {
    withDefaultRoutes([draftAgent])
    Object.defineProperty(window.history, 'state', { value: null, configurable: true, writable: true })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /back to chat/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})

describe('Agent list', () => {
  it('renders agents with deployed vs draft badges', async () => {
    withDefaultRoutes([draftAgent, deployedAgent])
    renderConsole()

    expect(await screen.findByText('Research Bot')).toBeInTheDocument()
    expect(screen.getByText('Live Agent')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('"+ New Agent" opens an empty panel', async () => {
    withDefaultRoutes([draftAgent])
    const user = userEvent.setup()
    renderConsole()

    await screen.findByText('Research Bot')
    await user.click(screen.getByRole('button', { name: /\+ new agent/i }))

    expect(screen.getByLabelText('Agent Name')).toHaveValue('')
    expect(screen.getByText('New Draft')).toBeInTheDocument()
  })

  it('clicking a card opens the panel pre-filled', async () => {
    withDefaultRoutes([draftAgent])
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByText('Research Bot'))

    expect(screen.getByLabelText('Agent Name')).toHaveValue('Research Bot')
    expect(screen.getByLabelText('Agent Role')).toHaveValue('Researcher')
    expect(screen.getByLabelText('Primary Goal')).toHaveValue('Find sources')
    expect(screen.getByLabelText('Safety & Execution Guardrails')).toHaveValue('no medical advice\nno legal advice')
  })

  it('deletes an agent after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes([draftAgent], (path, options) => {
      if (path === '/api/v1/agents/a1' && options?.method === 'DELETE') return undefined
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderConsole()

    await screen.findByText('Research Bot')
    await user.click(screen.getByLabelText('Delete Research Bot'))

    await waitFor(() => expect(screen.queryByText('Research Bot')).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('shows an error and keeps the agent listed when delete fails', async () => {
    const { ApiError } = await import('../lib/api')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    withDefaultRoutes([draftAgent], (path, options) => {
      if (path === '/api/v1/agents/a1' && options?.method === 'DELETE') {
        throw new ApiError(500, [{ message: 'Failed to delete agent. Please try again.' }])
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderConsole()

    await screen.findByText('Research Bot')
    await user.click(screen.getByLabelText('Delete Research Bot'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete agent')
    expect(screen.getByText('Research Bot')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

describe('Builder panel', () => {
  it('splits guardrail lines into patterns and sends is_deployed:false on Save Draft', async () => {
    let sentBody: unknown = null
    withDefaultRoutes([], (path, options) => {
      if (path === '/api/v1/agents' && options?.method === 'POST') {
        sentBody = JSON.parse(options.body as string)
        return { ...draftAgent, ...(sentBody as object) }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    await user.type(screen.getByLabelText('Agent Name'), 'New Agent')
    await user.type(screen.getByLabelText('Agent Role'), 'Helper')
    await user.type(screen.getByLabelText('Primary Goal'), 'Help')
    await user.type(screen.getByLabelText('Safety & Execution Guardrails'), 'no A{enter}no B')
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({
      name: 'New Agent',
      role: 'Helper',
      primary_goal: 'Help',
      guardrail_patterns: ['no A', 'no B'],
      is_deployed: false,
    })
  })

  it('deploys a brand-new agent in one click via create-then-patch (live bug: the backend\'s CreateAgentRequest silently ignores is_deployed on POST, only PATCH accepts it)', async () => {
    const calls: { path: string; method: string; body: unknown }[] = []
    withDefaultRoutes([], (path, options) => {
      const method = options?.method ?? 'GET'
      const body = options?.body ? JSON.parse(options.body as string) : undefined
      calls.push({ path, method, body })
      if (path === '/api/v1/agents' && method === 'POST') {
        // Mirrors the real backend: is_deployed is NOT part of CreateAgentRequest,
        // so it's silently dropped -- a fresh agent is always created as a draft.
        return { ...draftAgent, ...(body as object), is_deployed: false }
      }
      if (path === '/api/v1/agents/a1' && method === 'PATCH') {
        return { ...draftAgent, ...(body as object) }
      }
      throw new Error(`unexpected call: ${path} ${method}`)
    })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    await user.type(screen.getByLabelText('Agent Name'), 'New Agent')
    await user.type(screen.getByLabelText('Agent Role'), 'Helper')
    await user.type(screen.getByLabelText('Primary Goal'), 'Help')
    await user.click(screen.getByRole('button', { name: /deploy agent/i }))

    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toMatchObject({ path: '/api/v1/agents', method: 'POST' })
    expect(calls[1]).toMatchObject({ path: '/api/v1/agents/a1', method: 'PATCH', body: { is_deployed: true } })
    expect(await screen.findByText('Deployed')).toBeInTheDocument()
  })

  it('selecting Custom output format reveals the output instructions field', async () => {
    withDefaultRoutes([draftAgent])
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    expect(screen.queryByLabelText('Output instructions')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.getByLabelText('Output instructions')).toBeInTheDocument()
  })

  it('toggles allowed_tools checkboxes', async () => {
    let sentBody: { allowed_tools?: string[] } | null = null
    withDefaultRoutes([], (path, options) => {
      if (path === '/api/v1/agents' && options?.method === 'POST') {
        sentBody = JSON.parse(options.body as string)
        return { ...draftAgent, ...(sentBody as object) }
      }
      throw new Error(`unexpected call: ${path}`)
    })
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    await user.type(screen.getByLabelText('Agent Name'), 'x')
    await user.type(screen.getByLabelText('Agent Role'), 'x')
    await user.type(screen.getByLabelText('Primary Goal'), 'x')
    await user.click(screen.getByLabelText('Web search'))
    await user.click(screen.getByLabelText('Docs'))
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody!.allowed_tools).toEqual(['web_search', 'docs'])
  })

  it('toggles MCP server selection via the picker pill', async () => {
    withDefaultRoutes([draftAgent])
    const user = userEvent.setup()
    renderConsole()

    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    await user.click(screen.getByRole('button', { name: /\+ add mcp/i }))
    await user.click(screen.getByRole('button', { name: 'search-mcp' }))

    const pill = screen.getByText('search-mcp').closest('span')
    expect(pill).toBeInTheDocument()

    await user.click(within(pill as HTMLElement).getByLabelText('Remove search-mcp'))
    expect(screen.queryByText('search-mcp')).not.toBeInTheDocument()
  })

  it('shows an inline error and does not submit when json_schema is invalid JSON', async () => {
    withDefaultRoutes([draftAgent])
    const user = userEvent.setup()
    renderConsole()

    mockApiFetch.mockClear()
    await user.click(await screen.findByRole('button', { name: /\+ new agent/i }))
    await user.type(screen.getByLabelText('Agent Name'), 'x')
    await user.type(screen.getByLabelText('Agent Role'), 'x')
    await user.type(screen.getByLabelText('Primary Goal'), 'x')
    await user.type(screen.getByLabelText('JSON Schema (optional, raw JSON)'), '{{not valid json')
    mockApiFetch.mockClear()
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    expect(await screen.findByText('Invalid JSON')).toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/v1/agents', expect.objectContaining({ method: 'POST' }))
  })
})
