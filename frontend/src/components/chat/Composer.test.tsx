import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'
import type { ComposerTarget } from './TargetPicker'

const rawTarget: ComposerTarget = {
  kind: 'raw',
  provider: 'google_ai_studio',
  model: 'gemini-2.5-flash',
  enabled: true,
}
const agentTarget: ComposerTarget = {
  kind: 'agent',
  agentId: 'agent-1',
  agentName: 'Research Bot',
  provider: 'openai',
  model: 'gpt-5',
  enabled: true,
}
const disabledRawTarget: ComposerTarget = { ...rawTarget, enabled: false }

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = overrides.onSend ?? vi.fn().mockResolvedValue(undefined)
  const onToggleAgentMode = overrides.onToggleAgentMode ?? vi.fn()
  const onSynthesizeChange = overrides.onSynthesizeChange ?? vi.fn()
  const props: React.ComponentProps<typeof Composer> = {
    activeProviders: ['openai'],
    noActiveKeys: false,
    streaming: false,
    targets: [],
    agentMode: false,
    onToggleAgentMode,
    synthesize: false,
    onSynthesizeChange,
    onSend,
    ...overrides,
  }
  const view = render(<Composer {...props} />)
  return { ...view, onSend, onToggleAgentMode, onSynthesizeChange }
}

describe('Composer double-submit guard', () => {
  it('does not call onSend twice for two rapid sends before the first resolves', async () => {
    const user = userEvent.setup()
    let resolveSend: () => void = () => {}
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
    )

    renderComposer({ targets: [rawTarget], onSend })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')

    const sendButton = screen.getByRole('button', { name: /send/i })
    await user.click(sendButton)
    await user.click(sendButton) // rapid second click before onSend's promise settles

    expect(onSend).toHaveBeenCalledTimes(1)
    resolveSend()
  })

  it('allows a new send once the previous one resolves', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn().mockResolvedValue(undefined)

    renderComposer({ targets: [rawTarget], onSend })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'first')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledTimes(1)

    await user.type(screen.getByPlaceholderText('Ask anything'), 'second')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledTimes(2)
  })
})

describe('Composer send gating', () => {
  it('disables send with no text even once a target exists', () => {
    renderComposer({ targets: [rawTarget] })
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('disables send with text but no target', async () => {
    const user = userEvent.setup()
    renderComposer({ targets: [] })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('enables send once both text and a target are present', async () => {
    const user = userEvent.setup()
    renderComposer({ targets: [rawTarget] })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled()
  })

  it('disables send while streaming even with text and a target', () => {
    renderComposer({ targets: [rawTarget], streaming: true })
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('disables send with text when the only configured target is unchecked (disabled)', async () => {
    const user = userEvent.setup()
    renderComposer({ targets: [disabledRawTarget] })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('enables send when at least one target is enabled, even alongside a disabled one', async () => {
    const user = userEvent.setup()
    renderComposer({ targets: [disabledRawTarget, rawTarget] })
    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled()
  })
})

describe('Composer Agent Mode toggle', () => {
  it('renders unpressed by default and calls onToggleAgentMode on click', async () => {
    const user = userEvent.setup()
    const { onToggleAgentMode } = renderComposer()

    const toggle = screen.getByRole('button', { name: 'Agent Mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle.className).not.toMatch(/border-accent/)

    await user.click(toggle)
    expect(onToggleAgentMode).toHaveBeenCalledTimes(1)
  })

  it('shows an accent border when agentMode is on', () => {
    renderComposer({ agentMode: true })
    const toggle = screen.getByRole('button', { name: 'Agent Mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle.className).toMatch(/border-accent/)
  })

  it('hides Web Search/Deep Research once agent mode has a selected target, and forces them off in onSend', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ agentMode: true, targets: [agentTarget] })

    expect(screen.queryByRole('button', { name: 'Web Search' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deep Research' })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onSend).toHaveBeenCalledWith('hello', { useWebSearch: false, useDeepResearch: false })
  })

  it('keeps Web Search/Deep Research visible in agent mode with nothing selected yet', () => {
    renderComposer({ agentMode: true, targets: [] })
    expect(screen.getByRole('button', { name: 'Web Search' })).toBeInTheDocument()
  })
})

describe('Composer synthesize toggle', () => {
  it('is hidden in raw mode even with 2+ targets', () => {
    renderComposer({ agentMode: false, targets: [rawTarget, rawTarget] })
    expect(screen.queryByText(/synthesize/i)).not.toBeInTheDocument()
  })

  it('is hidden in agent mode below 2 targets', () => {
    renderComposer({ agentMode: true, targets: [agentTarget] })
    expect(screen.queryByText(/synthesize/i)).not.toBeInTheDocument()
  })

  it('stays hidden when a second agent target is configured but disabled (unchecked)', () => {
    renderComposer({ agentMode: true, targets: [agentTarget, { ...agentTarget, enabled: false }] })
    expect(screen.queryByText(/synthesize/i)).not.toBeInTheDocument()
  })

  it('appears at 2+ agent targets, disabled under 3 distinct active providers', () => {
    renderComposer({
      agentMode: true,
      targets: [agentTarget, agentTarget],
      activeProviders: ['openai', 'anthropic'],
    })
    const checkbox = screen.getByRole('checkbox', { name: /synthesize/i })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText(/needs 3\+ connected provider keys/i)).toBeInTheDocument()
  })

  it('is enabled at 3+ distinct active providers and calls onSynthesizeChange', async () => {
    const user = userEvent.setup()
    const { onSynthesizeChange } = renderComposer({
      agentMode: true,
      targets: [agentTarget, agentTarget],
      activeProviders: ['openai', 'anthropic', 'groq'],
    })
    const checkbox = screen.getByRole('checkbox', { name: /synthesize/i })
    expect(checkbox).not.toBeDisabled()
    await user.click(checkbox)
    expect(onSynthesizeChange).toHaveBeenCalledWith(true)
  })
})

describe('Composer web-search/deep-research toggles', () => {
  it('has no standalone "Use Docs" toggle -- doc-grounding is driven by the sidebar checklist instead', () => {
    renderComposer()
    expect(screen.queryByRole('button', { name: 'Use Docs' })).not.toBeInTheDocument()
  })

  it('defaults both off and reaches onSend as false', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ targets: [rawTarget] })

    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onSend).toHaveBeenCalledWith('hello', { useWebSearch: false, useDeepResearch: false })
  })

  it('toggling Web Search reaches onSend as true and shows an accent border', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ targets: [rawTarget] })

    const webSearchBtn = screen.getByRole('button', { name: 'Web Search' })
    await user.click(webSearchBtn)
    expect(webSearchBtn.className).toMatch(/border-accent/)

    await user.type(screen.getByPlaceholderText('Ask anything'), 'hello')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onSend).toHaveBeenCalledWith('hello', { useWebSearch: true, useDeepResearch: false })
  })

  it('Web Search and Deep Research are mutually exclusive client-side', async () => {
    const user = userEvent.setup()
    renderComposer({ targets: [rawTarget] })

    const webSearchBtn = screen.getByRole('button', { name: 'Web Search' })
    const deepResearchBtn = screen.getByRole('button', { name: 'Deep Research' })

    await user.click(webSearchBtn)
    expect(webSearchBtn).toHaveAttribute('aria-pressed', 'true')

    await user.click(deepResearchBtn)
    expect(deepResearchBtn).toHaveAttribute('aria-pressed', 'true')
    expect(webSearchBtn).toHaveAttribute('aria-pressed', 'false') // turning Deep Research on turns Web Search off
    expect(webSearchBtn.className).not.toMatch(/border-accent/)
    expect(deepResearchBtn.className).toMatch(/border-accent/)

    await user.click(webSearchBtn)
    expect(webSearchBtn).toHaveAttribute('aria-pressed', 'true')
    expect(deepResearchBtn).toHaveAttribute('aria-pressed', 'false') // and vice versa
  })
})
