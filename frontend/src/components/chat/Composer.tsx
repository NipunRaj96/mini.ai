import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { Button } from '../ui/Button'
import type { Provider } from '../../lib/chat'
import type { ComposerTarget } from './TargetPicker'

interface ComposerProps {
  activeProviders: Provider[]
  noActiveKeys: boolean
  streaming: boolean
  targets: ComposerTarget[]
  agentMode: boolean
  onToggleAgentMode: () => void
  synthesize: boolean
  onSynthesizeChange: (value: boolean) => void
  onSend: (content: string, opts: { useWebSearch: boolean; useDeepResearch: boolean }) => void | Promise<void>
}

/** Floating input dock: mode toggles + auto-growing textarea. Target
 * selection itself lives in the header's TargetPicker now (see Home.tsx) --
 * this component only reads `targets`/`agentMode` to gate send and to decide
 * which per-turn toggles apply. */
export function Composer({
  activeProviders,
  noActiveKeys,
  streaming,
  targets,
  agentMode,
  onToggleAgentMode,
  synthesize,
  onSynthesizeChange,
  onSend,
}: ComposerProps) {
  const [input, setInput] = useState('')
  const [useWebSearch, setUseWebSearch] = useState(false)
  const [useDeepResearch, setUseDeepResearch] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Synchronous lock, released in submit()'s own finally once onSend's promise
  // settles -- `streaming` is a prop that only flips after Home.tsx's async
  // handleSend runs (and, for the very first message, after an awaited
  // createConversation() call), so two Enter presses in the same tick could
  // both pass `canSend` before that prop update lands. Owning the lock locally
  // (rather than syncing off the `streaming` prop) also means a rejection
  // Home.tsx never turns into `streaming=true` still releases the lock.
  const sendingRef = useRef(false)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [input])

  if (noActiveKeys) {
    return (
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-[var(--space-lg)] pb-[var(--space-lg)]">
        <div className="w-full max-w-4xl rounded-lg border border-rail-border bg-surface px-[var(--space-lg)] py-[var(--space-md)] font-body text-sm text-on-surface-mid">
          Add a provider key in Settings to start chatting.
        </div>
      </div>
    )
  }

  // A target sitting in the list but unchecked isn't "selected" -- only
  // enabled ones gate send, count toward agent-target detection, or unlock
  // the synthesize checkbox below.
  const enabledCount = targets.filter((t) => t.enabled).length
  const canSend = input.trim().length > 0 && enabledCount > 0 && !streaming
  // Same distinct-active-provider count Home.tsx already derives from
  // listKeys() into `activeProviders` -- reused as-is instead of a second
  // fetch, it's exactly the number the backend's synthesize gate checks.
  const synthesizeEligible = activeProviders.length >= 3
  // The backend rejects use_web_search/use_deep_research outright when the
  // request carries any agent_targets (an agent's own allowed_tools is
  // authoritative instead) -- so these toggles only apply to an all-raw send.
  // Agent mode + at least one selected target means the send will carry
  // agent_targets, so force them off/hidden in that case.
  const hasAgentTargets = agentMode && enabledCount > 0
  const effectiveUseWebSearch = !hasAgentTargets && useWebSearch
  const effectiveUseDeepResearch = !hasAgentTargets && useDeepResearch

  async function submit() {
    if (!canSend || sendingRef.current) return
    sendingRef.current = true
    const text = input.trim()
    setInput('')
    try {
      await onSend(text, { useWebSearch: effectiveUseWebSearch, useDeepResearch: effectiveUseDeepResearch })
    } finally {
      sendingRef.current = false
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center px-[var(--space-lg)] pb-[var(--space-lg)]">
      <div
        className={clsx(
          'w-full max-w-4xl rounded-lg border bg-surface p-[var(--space-md)] shadow-[var(--shadow-level3)] transition-colors duration-150',
          focused ? 'border-[#2f323c]' : 'border-rail-border',
        )}
      >
        <div className="mb-[var(--space-sm)] flex flex-nowrap items-center gap-2 overflow-x-auto">
          <button
            type="button"
            aria-pressed={agentMode}
            disabled={streaming}
            onClick={onToggleAgentMode}
            className={clsx(
              'shrink-0 whitespace-nowrap rounded-pill border px-3 py-1 font-display text-[11px] font-medium uppercase tracking-[0.03em]',
              'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
              agentMode
                ? 'border-accent bg-rail-hover text-on-surface'
                : 'border-rail-border bg-rail-elevated text-on-surface-mid hover:text-on-surface',
            )}
          >
            Agent Mode
          </button>

          {!hasAgentTargets && (
            <>
              <button
                type="button"
                aria-pressed={useWebSearch}
                disabled={streaming}
                onClick={() => {
                  setUseWebSearch((v) => !v)
                  if (!useWebSearch) setUseDeepResearch(false)
                }}
                className={clsx(
                  'shrink-0 whitespace-nowrap rounded-pill border px-3 py-1 font-display text-[11px] font-medium uppercase tracking-[0.03em]',
                  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
                  useWebSearch
                    ? 'border-accent bg-rail-hover text-on-surface'
                    : 'border-rail-border bg-rail-elevated text-on-surface-mid hover:text-on-surface',
                )}
              >
                Web Search
              </button>
              <button
                type="button"
                aria-pressed={useDeepResearch}
                disabled={streaming}
                onClick={() => {
                  setUseDeepResearch((v) => !v)
                  if (!useDeepResearch) setUseWebSearch(false)
                }}
                className={clsx(
                  'shrink-0 whitespace-nowrap rounded-pill border px-3 py-1 font-display text-[11px] font-medium uppercase tracking-[0.03em]',
                  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
                  useDeepResearch
                    ? 'border-accent bg-rail-hover text-on-surface'
                    : 'border-rail-border bg-rail-elevated text-on-surface-mid hover:text-on-surface',
                )}
              >
                Deep Research
              </button>
            </>
          )}
        </div>

        {agentMode && enabledCount >= 2 && (
          <label className="mb-[var(--space-sm)] flex items-center gap-2 font-body text-xs text-on-surface-mid">
            <input
              type="checkbox"
              checked={synthesize}
              disabled={!synthesizeEligible}
              onChange={(e) => onSynthesizeChange(e.target.checked)}
            />
            Synthesize (judge/consensus)
            {!synthesizeEligible && (
              <span className="text-on-surface-low">— needs 3+ connected provider keys</span>
            )}
          </label>
        )}

        <div className="flex items-end gap-[var(--space-sm)]">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything"
            className="composer-textarea max-h-60 flex-1 resize-none bg-transparent font-body text-sm text-on-surface placeholder:text-on-surface-low focus:outline-none"
          />
          <Button onClick={submit} disabled={!canSend} loading={streaming}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
