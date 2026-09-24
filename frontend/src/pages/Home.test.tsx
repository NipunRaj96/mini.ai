import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../lib/api'
import { streamSSE } from '../lib/sse'
import { Home } from './Home'

/** Mirrors App.tsx's routing: both "/" and "/c/:conversationId" render the
 * same Home, so the active conversation's identity is the URL param, not
 * component-local state that a remount would reset. */
function renderHome(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/c/:conversationId" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  )
}

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../lib/sse', () => ({ streamSSE: vi.fn() }))
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@b.com', created_at: '2026-01-01T00:00:00Z' },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  }),
}))

const mockApiFetch = vi.mocked(apiFetch)
const mockStreamSSE = vi.mocked(streamSSE)

const activeKeys = [
  { id: 'k1', provider: 'openai', label: 'k1', masked_key: '***', is_active: true, created_at: 't' },
  { id: 'k2', provider: 'anthropic', label: 'k2', masked_key: '***', is_active: true, created_at: 't' },
]

const threeActiveKeys = [
  ...activeKeys,
  { id: 'k3', provider: 'groq', label: 'k3', masked_key: '***', is_active: true, created_at: 't' },
]

const deployedAgent = {
  id: 'agent-1',
  name: 'Research Bot',
  role: 'Researcher',
  primary_goal: 'Find sources',
  output_format: 'structured_markdown',
  output_instructions: null,
  json_schema: null,
  guardrail_patterns: [],
  allowed_tools: [],
  mcp_server_ids: [],
  is_deployed: true,
  created_at: 't',
  updated_at: 't',
}

const oneConversation = [{ id: 'c1', title: 'Existing chat', updated_at: '2026-01-01T00:00:00Z' }]

function routeApiFetch(impl: (path: string, options?: RequestInit) => unknown) {
  mockApiFetch.mockImplementation(async (path: string, options?: RequestInit) => impl(path, options))
}

/** The header TargetPicker is a Popover -- opening it once is enough for a
 * whole add-several-targets sequence (it stays open until "Done"/outside
 * click), so this only clicks the trigger when the popover isn't already
 * showing the form. Uses the stable testid rather than the trigger's label
 * text, since that text changes ("Choose models" -> a selection summary). */
async function ensurePickerOpen(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByLabelText(/model name/i)) return
  await user.click(screen.getByTestId('target-picker-trigger'))
  await waitFor(() => expect(screen.getByLabelText(/model name/i)).toBeInTheDocument())
}

async function goToExistingChat(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Existing chat')
  await user.click(screen.getByText('Existing chat'))
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockStreamSSE.mockReset()
})

describe('Home empty states', () => {
  it('shows "no active keys" messaging in the composer when there are no active keys', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return []
      if (path === '/api/v1/chat/conversations') return []
      throw new Error(`unexpected call: ${path}`)
    })

    renderHome()

    expect(await screen.findByText(/add a provider key in settings/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/ask anything/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('target-picker-trigger')).not.toBeInTheDocument()
  })

  it('shows "start your first conversation" when there are no conversations', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return []
      throw new Error(`unexpected call: ${path}`)
    })

    renderHome()

    expect(await screen.findByText(/start your first conversation/i)).toBeInTheDocument()
  })
})

describe('Home URL-driven active conversation', () => {
  const twoConversations = [
    { id: 'c1', title: 'First chat', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'c2', title: 'Second chat', updated_at: '2026-01-02T00:00:00Z' },
  ]

  function withTwoConversations() {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return twoConversations
      if (path === '/api/v1/agents') return []
      if (path === '/api/v1/chat/conversations/c1/messages') {
        return [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Hello from c1',
            provider: 'openai',
            model: 'gpt-5',
            request_group_id: 'g1',
            created_at: 't',
          },
        ]
      }
      if (path === '/api/v1/chat/conversations/c2/messages') {
        return [
          {
            id: 'm2',
            role: 'assistant',
            content: 'Hello from c2',
            provider: 'openai',
            model: 'gpt-5',
            request_group_id: 'g2',
            created_at: 't',
          },
        ]
      }
      throw new Error(`unexpected call: ${path}`)
    })
  }

  it('loads the conversation named by the URL param directly, with no local activeId state to reset', async () => {
    withTwoConversations()
    renderHome(['/c/c1'])

    expect(await screen.findByText('Hello from c1')).toBeInTheDocument()
  })

  it('switching conversations via the sidebar navigates the URL and swaps the visible messages', async () => {
    withTwoConversations()
    const user = userEvent.setup()
    renderHome(['/c/c1'])

    await screen.findByText('Hello from c1')
    await user.click(screen.getByText('Second chat'))

    expect(await screen.findByText('Hello from c2')).toBeInTheDocument()
    expect(screen.queryByText('Hello from c1')).not.toBeInTheDocument()
  })

  it('deleting the active conversation navigates to / and clears the chat', async () => {
    routeApiFetch((path, options) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      if (path === '/api/v1/chat/conversations/c1' && options?.method === 'DELETE') return undefined
      throw new Error(`unexpected call: ${path}`)
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderHome(['/c/c1'])

    await screen.findByText('Existing chat')
    await user.click(screen.getByLabelText('Delete Existing chat'))

    expect(await screen.findByText(/start your first conversation/i)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

describe('Home header target picker', () => {
  it('defaults to "Choose models" (raw mode) at the top of the pane', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    renderHome()
    await screen.findByText('Existing chat')

    expect(screen.getByText('Choose models')).toBeInTheDocument()
  })

  it('Agent Mode switches the header pill to "Choose agents" and clears prior raw selections', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return [deployedAgent]
      throw new Error(`unexpected call: ${path}`)
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)

    // Pick a raw target first.
    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    await user.click(screen.getByTestId('target-picker-trigger')) // close

    // Flip Agent Mode on -- the raw selection must not silently ride along.
    await user.click(screen.getByRole('button', { name: 'Agent Mode' }))
    expect(screen.getByText('Choose agents')).toBeInTheDocument()
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument()

    // Pick an agent target.
    await ensurePickerOpen(user)
    await waitFor(() => expect(screen.getByLabelText('Agent')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await user.click(screen.getByTestId('target-picker-trigger')) // close
    expect(screen.getByText('Research Bot')).toBeInTheDocument()

    // Flip back to raw mode -- the agent selection must be cleared too.
    await user.click(screen.getByRole('button', { name: 'Agent Mode' }))
    expect(screen.getByText('Choose models')).toBeInTheDocument()
    expect(screen.queryByText('Research Bot')).not.toBeInTheDocument()
  })
})

describe('Home configured-target enable/disable', () => {
  it('unchecking a configured target keeps it in the list and blocks send, until re-checked -- no retyping needed', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hello')

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).not.toBeDisabled()
    expect(screen.getByText('gpt-5')).toBeInTheDocument() // header pill summary

    // Uncheck the row -- target must stay in the popover list, just deselected.
    const checkbox = screen.getByLabelText('Use OpenAI · gpt-5')
    await user.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('OpenAI · gpt-5')).toBeInTheDocument() // still listed
    expect(sendButton).toBeDisabled() // no enabled targets left
    expect(screen.getByText('Choose models')).toBeInTheDocument() // pill summary drops it

    // Re-check it -- same row, same provider/model, no re-entry.
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(sendButton).not.toBeDisabled()
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
  })

  it('the separate remove button actually deletes a target from the list', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByLabelText('Use OpenAI · gpt-5')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Remove OpenAI · gpt-5 from list'))

    expect(screen.queryByLabelText('Use OpenAI · gpt-5')).not.toBeInTheDocument()
    expect(screen.getByText('Choose models')).toBeInTheDocument()
  })

  it('excludes a disabled (unchecked) target from the actual send payload', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockStreamSSE.mockImplementation(() => new Promise(() => {}))

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hi there')

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.selectOptions(screen.getByLabelText(/provider/i), 'anthropic')
    await user.type(screen.getByLabelText(/model name/i), 'claude-opus')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    // Disable the anthropic target -- it must not appear in the payload.
    await user.click(screen.getByLabelText('Use Anthropic · claude-opus'))

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))
    const [, body] = mockStreamSSE.mock.calls[0]
    expect(body).toEqual({ content: 'hi there', targets: [{ provider: 'openai', model: 'gpt-5' }] })
  })
})

describe('Home composer send state', () => {
  it('disables send with no text or no targets, and re-disables once streaming starts', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    let resolveStream: () => void = () => {}
    mockStreamSSE.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = () => resolve(undefined)
        }),
    )

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)

    const sendButton = await screen.findByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hello')
    expect(sendButton).toBeDisabled() // still no target

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(sendButton).not.toBeDisabled()

    await user.click(sendButton)
    expect(sendButton).toBeDisabled()

    resolveStream()
    await waitFor(() => expect(sendButton).toBeDisabled()) // no text after send clears input
  })
})

describe('Home SSE streaming', () => {
  it('accumulates interleaved deltas from two different targets into separate blocks', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    let capturedOnEvent: (event: string, data: string) => void = () => {}
    mockStreamSSE.mockImplementation((_path, _body, onEvent) => {
      capturedOnEvent = onEvent
      return new Promise(() => {}) // never resolves in this test
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'compare these')

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.selectOptions(screen.getByLabelText(/provider/i), 'anthropic')
    await user.type(screen.getByLabelText(/model name/i), 'claude-opus')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))

    capturedOnEvent('delta', JSON.stringify({ provider: 'openai', model: 'gpt-5', text: 'Hel' }))
    capturedOnEvent('delta', JSON.stringify({ provider: 'anthropic', model: 'claude-opus', text: 'Bon' }))
    capturedOnEvent('delta', JSON.stringify({ provider: 'openai', model: 'gpt-5', text: 'lo' }))
    capturedOnEvent('delta', JSON.stringify({ provider: 'anthropic', model: 'claude-opus', text: 'jour' }))

    const openaiBlock = await screen.findByTestId('stream-block-openai::gpt-5')
    const anthropicBlock = screen.getByTestId('stream-block-anthropic::claude-opus')

    expect(within(openaiBlock).getByText('Hello')).toBeInTheDocument()
    expect(within(anthropicBlock).getByText('Bonjour')).toBeInTheDocument()
  })

  it('renders a live trace line per tool_call event, and resets it on the next send', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    let capturedOnEvent: (event: string, data: string) => void = () => {}
    mockStreamSSE.mockImplementation((_path, _body, onEvent) => {
      capturedOnEvent = onEvent
      return new Promise(() => {}) // never resolves in this test
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'what changed recently')

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))

    capturedOnEvent('tool_call', JSON.stringify({ name: 'web_search', arguments: { query: 'recent RBI notices' } }))
    capturedOnEvent('tool_call', JSON.stringify({ name: 'search_docs', arguments: { query: 'internal policy doc' } }))

    const trace = await screen.findByTestId('tool-call-trace')
    expect(trace).toHaveTextContent('Searching the web: "recent RBI notices"')
    expect(trace).toHaveTextContent('Searching your documents: "internal policy doc"')

    // A missing/empty query must not crash the trace, just fall back to the verb.
    capturedOnEvent('tool_call', JSON.stringify({ name: 'deep_research', arguments: {} }))
    expect(await screen.findByText('Researching')).toBeInTheDocument()
  })

  it('clears the tool-call trace once a turn finishes, before the next send starts', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    let capturedOnEvent: (event: string, data: string) => void = () => {}
    let resolveStream: () => void = () => {}
    mockStreamSSE.mockImplementation((_path, _body, onEvent) => {
      capturedOnEvent = onEvent
      return new Promise((resolve) => {
        resolveStream = () => resolve(undefined)
      })
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'first turn')
    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))

    capturedOnEvent('tool_call', JSON.stringify({ name: 'web_search', arguments: { query: 'first turn query' } }))
    await screen.findByTestId('tool-call-trace')

    resolveStream()
    await waitFor(() => expect(screen.queryByTestId('tool-call-trace')).not.toBeInTheDocument())
  })

  it('refetches the message list and conversation list on "done"', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })

    mockStreamSSE.mockImplementation(async (_path, _body, onEvent) => {
      onEvent('done', JSON.stringify({ conversation_id: 'c1' }))
    })

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hi there')
    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    mockApiFetch.mockClear()

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/chat/conversations/c1/messages')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/chat/conversations')
    })
  })
})

describe('Home send payload construction', () => {
  it('sends only a targets key (no agent_targets, no synthesize) for an all-raw send', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockStreamSSE.mockImplementation(() => new Promise(() => {}))

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hi there')
    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))
    const [, body] = mockStreamSSE.mock.calls[0]
    expect(body).toEqual({ content: 'hi there', targets: [{ provider: 'openai', model: 'gpt-5' }] })
  })

  it('sends agent_targets and synthesize for an all-agent send in Agent Mode', async () => {
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return threeActiveKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return [deployedAgent]
      throw new Error(`unexpected call: ${path}`)
    })
    mockStreamSSE.mockImplementation(() => new Promise(() => {}))

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'compare these')

    await user.click(screen.getByRole('button', { name: 'Agent Mode' }))

    await ensurePickerOpen(user)
    await waitFor(() => expect(screen.getByLabelText('Agent')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    await user.selectOptions(screen.getByLabelText(/provider/i), 'anthropic')
    await user.type(screen.getByLabelText(/model name/i), 'claude-opus')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    // Second agent target so the synthesize checkbox appears (2+ agent
    // targets, 3+ distinct active provider keys).
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    await user.selectOptions(screen.getByLabelText(/provider/i), 'openai')
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const checkbox = await screen.findByRole('checkbox', { name: /synthesize/i })
    expect(checkbox).not.toBeDisabled()
    await user.click(checkbox)

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))
    const [, body] = mockStreamSSE.mock.calls[0]
    expect(body).toEqual({
      content: 'compare these',
      agent_targets: [
        { agent_id: 'agent-1', provider: 'anthropic', model: 'claude-opus' },
        { agent_id: 'agent-1', provider: 'openai', model: 'gpt-5' },
      ],
      synthesize: true,
    })
  })

  it('sends sidebar-checked docs as document_ids, deriving use_docs from the checklist', async () => {
    const readyDoc = {
      id: 'd1',
      filename: 'policy.pdf',
      content_type: 'text/plain',
      status: 'ready',
      error_message: null,
      created_at: 't',
    }
    routeApiFetch((path) => {
      if (path === '/api/v1/keys') return activeKeys
      if (path === '/api/v1/chat/conversations') return oneConversation
      if (path === '/api/v1/chat/conversations/c1/messages') return []
      if (path === '/api/v1/agents') return []
      if (path === '/api/v1/docs') return [readyDoc]
      throw new Error(`unexpected call: ${path}`)
    })
    mockStreamSSE.mockImplementation(() => new Promise(() => {}))

    const user = userEvent.setup()
    renderHome()
    await goToExistingChat(user)
    await user.type(screen.getByPlaceholderText(/ask anything/i), 'hi there')

    await ensurePickerOpen(user)
    await user.type(screen.getByLabelText(/model name/i), 'gpt-5')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await user.click(await screen.findByLabelText('Use policy.pdf for grounding'))

    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockStreamSSE).toHaveBeenCalledTimes(1))
    const [, body] = mockStreamSSE.mock.calls[0]
    expect(body).toEqual({
      content: 'hi there',
      targets: [{ provider: 'openai', model: 'gpt-5' }],
      use_docs: true,
      document_ids: ['d1'],
    })
  })
})
