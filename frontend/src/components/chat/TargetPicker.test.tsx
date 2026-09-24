import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../lib/api'
import { TargetPicker } from './TargetPicker'
import type { ComposerTarget } from './TargetPicker'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))

const mockApiFetch = vi.mocked(apiFetch)

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

const groqModels = [
  { id: 'llama-3.3-70b-versatile', display_name: 'llama-3.3-70b-versatile', context_window: 128000 },
  { id: 'gemma2-9b-it', display_name: 'gemma2-9b-it', context_window: 8192 },
]

// Default: agents list resolves normally, any provider's model list resolves
// empty -- which drives ModelField into its manual-entry fallback, matching
// the pre-live-list behavior the older tests below assert against unless a
// test overrides this per path.
function defaultApiFetch(path: string) {
  if (path === '/api/v1/agents') return Promise.resolve([deployedAgent])
  if (path.startsWith('/api/v1/providers/')) return Promise.resolve([])
  return Promise.resolve([])
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(defaultApiFetch)
})

function renderPicker(overrides: Partial<React.ComponentProps<typeof TargetPicker>> = {}) {
  const onAdd = overrides.onAdd ?? vi.fn()
  const onToggleEnabled = overrides.onToggleEnabled ?? vi.fn()
  const onRemove = overrides.onRemove ?? vi.fn()
  const props: React.ComponentProps<typeof TargetPicker> = {
    activeProviders: ['openai'],
    agentMode: false,
    targets: [],
    onAdd,
    onToggleEnabled,
    onRemove,
    ...overrides,
  }
  const view = render(<TargetPicker {...props} />)
  return { ...view, onAdd, onToggleEnabled, onRemove }
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('target-picker-trigger'))
  await waitFor(() => expect(screen.getByLabelText('Model name')).toBeInTheDocument())
}

describe('TargetPicker trigger label', () => {
  it('shows "Choose models" by default (raw mode, nothing selected)', () => {
    renderPicker({ agentMode: false, targets: [] })
    expect(screen.getByText('Choose models')).toBeInTheDocument()
  })

  it('shows "Choose agents" in agent mode with nothing selected', () => {
    renderPicker({ agentMode: true, targets: [] })
    expect(screen.getByText('Choose agents')).toBeInTheDocument()
  })

  it('summarizes up to 2 selected targets by name, then "+N" beyond that', () => {
    const targets: ComposerTarget[] = [
      { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: true },
      { kind: 'raw', provider: 'anthropic', model: 'claude-opus', enabled: true },
      { kind: 'raw', provider: 'groq', model: 'llama-70b', enabled: true },
    ]
    renderPicker({ targets })
    expect(screen.getByText('gpt-5, claude-opus +1')).toBeInTheDocument()
  })

  it('counts only enabled targets in the summary, skipping unchecked ones', () => {
    const targets: ComposerTarget[] = [
      { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: true },
      { kind: 'raw', provider: 'anthropic', model: 'claude-opus', enabled: false },
    ]
    renderPicker({ targets })
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
  })

  it('falls back to "Choose models" when every configured target is unchecked', () => {
    const targets: ComposerTarget[] = [{ kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: false }]
    renderPicker({ targets })
    expect(screen.getByText('Choose models')).toBeInTheDocument()
  })
})

describe('TargetPicker raw mode (manual fallback, provider with no live list)', () => {
  it('adds a raw target via provider+model and reports it through onAdd', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderPicker({ agentMode: false })

    await openPicker(user)
    await user.type(screen.getByLabelText('Model name'), 'gemini-2.5-flash')
    await user.click(screen.getByText('Add'))

    expect(onAdd).toHaveBeenCalledWith({ kind: 'raw', provider: 'openai', model: 'gemini-2.5-flash', enabled: true })
  })

  it('keeps Add disabled until a model name is typed', async () => {
    const user = userEvent.setup()
    renderPicker({ agentMode: false })
    await openPicker(user)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('does not show the agent select in raw mode', async () => {
    const user = userEvent.setup()
    renderPicker({ agentMode: false })
    await openPicker(user)
    expect(screen.queryByLabelText('Agent')).not.toBeInTheDocument()
  })

  it('shows a fallback note explaining why manual entry is used', async () => {
    const user = userEvent.setup()
    renderPicker({ agentMode: false })
    await openPicker(user)
    expect(screen.getByText(/Model list unavailable for this provider/)).toBeInTheDocument()
  })
})

describe('TargetPicker raw mode (live model list)', () => {
  it('populates a model dropdown from listModels and adds the selected id', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/providers/groq/models') return Promise.resolve(groqModels)
      return defaultApiFetch(path)
    })
    const { onAdd } = renderPicker({ agentMode: false, activeProviders: ['groq'] })

    await user.click(screen.getByTestId('target-picker-trigger'))
    await waitFor(() => expect(screen.getByLabelText('Model')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'llama-3.3-70b-versatile' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'gemma2-9b-it' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Model'), 'gemma2-9b-it')
    await user.click(screen.getByText('Add'))

    expect(onAdd).toHaveBeenCalledWith({ kind: 'raw', provider: 'groq', model: 'gemma2-9b-it', enabled: true })
  })

  it('shows a loading placeholder while models are in flight and blocks Add', async () => {
    const user = userEvent.setup()
    let resolveModels: (v: typeof groqModels) => void
    const pending = new Promise<typeof groqModels>((resolve) => {
      resolveModels = resolve
    })
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/providers/groq/models') return pending
      return defaultApiFetch(path)
    })
    renderPicker({ agentMode: false, activeProviders: ['groq'] })

    await user.click(screen.getByTestId('target-picker-trigger'))
    await waitFor(() => expect(screen.getByLabelText('Model')).toBeInTheDocument())
    expect(screen.getByLabelText('Model')).toBeDisabled()
    expect(screen.getByText('Loading models…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    resolveModels!(groqModels)
    await waitFor(() => expect(screen.getByLabelText('Model')).not.toBeDisabled())
  })

  it('falls back to manual entry when listModels rejects (e.g. a 400)', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/providers/groq/models') return Promise.reject(new Error('400'))
      return defaultApiFetch(path)
    })
    renderPicker({ agentMode: false, activeProviders: ['groq'] })

    await user.click(screen.getByTestId('target-picker-trigger'))
    await waitFor(() => expect(screen.getByLabelText('Model name')).toBeInTheDocument())
    expect(screen.getByText(/Model list unavailable for this provider/)).toBeInTheDocument()
  })
})

describe('TargetPicker agent mode', () => {
  it('requires an agent selection before Add is enabled', async () => {
    const user = userEvent.setup()
    renderPicker({ agentMode: true })
    await openPicker(user)
    await waitFor(() => expect(screen.getByLabelText('Agent')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Model name'), 'gpt-5')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled()
  })

  it('adds an agent target paired with its own provider+model', async () => {
    const user = userEvent.setup()
    const { onAdd } = renderPicker({ agentMode: true })
    await openPicker(user)
    await waitFor(() => expect(screen.getByLabelText('Agent')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    await user.type(screen.getByLabelText('Model name'), 'gpt-5')
    await user.click(screen.getByText('Add'))

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'agent',
      agentId: 'agent-1',
      agentName: 'Research Bot',
      provider: 'openai',
      model: 'gpt-5',
      enabled: true,
    })
  })

  it('populates the live model dropdown in agent mode too, and adds agent+provider+model id', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/providers/groq/models') return Promise.resolve(groqModels)
      return defaultApiFetch(path)
    })
    const { onAdd } = renderPicker({ agentMode: true, activeProviders: ['groq'] })

    await user.click(screen.getByTestId('target-picker-trigger'))
    await waitFor(() => expect(screen.getByLabelText('Model')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-1')
    await user.selectOptions(screen.getByLabelText('Model'), 'llama-3.3-70b-versatile')
    await user.click(screen.getByText('Add'))

    expect(onAdd).toHaveBeenCalledWith({
      kind: 'agent',
      agentId: 'agent-1',
      agentName: 'Research Bot',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      enabled: true,
    })
  })
})

describe('TargetPicker configured-target rows', () => {
  it('shows an enabled target as a checked row, and unchecking it toggles enabled off (not a removal)', async () => {
    const user = userEvent.setup()
    const target: ComposerTarget = { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: true }
    const { onToggleEnabled, onRemove } = renderPicker({ targets: [target] })

    await openPicker(user)
    const checkbox = screen.getByLabelText('Use OpenAI · gpt-5')
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(onToggleEnabled).toHaveBeenCalledWith(0, false)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('shows a disabled (unchecked) target as unchecked but still visible in the list', async () => {
    const user = userEvent.setup()
    const target: ComposerTarget = { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: false }
    renderPicker({ targets: [target] })

    await openPicker(user)
    const checkbox = screen.getByLabelText('Use OpenAI · gpt-5')
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('OpenAI · gpt-5')).toBeInTheDocument()
  })

  it('re-checking a disabled target flips it back to enabled via the same toggle, no re-entry', async () => {
    const user = userEvent.setup()
    const target: ComposerTarget = { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: false }
    const { onToggleEnabled } = renderPicker({ targets: [target] })

    await openPicker(user)
    await user.click(screen.getByLabelText('Use OpenAI · gpt-5'))
    expect(onToggleEnabled).toHaveBeenCalledWith(0, true)
  })

  it('has a separate remove button, distinct from the checkbox, that calls onRemove', async () => {
    const user = userEvent.setup()
    const target: ComposerTarget = { kind: 'raw', provider: 'openai', model: 'gpt-5', enabled: true }
    const { onRemove, onToggleEnabled } = renderPicker({ targets: [target] })

    await openPicker(user)
    const removeButton = screen.getByLabelText('Remove OpenAI · gpt-5 from list')
    await user.click(removeButton)

    expect(onRemove).toHaveBeenCalledWith(0)
    expect(onToggleEnabled).not.toHaveBeenCalled()
  })
})
