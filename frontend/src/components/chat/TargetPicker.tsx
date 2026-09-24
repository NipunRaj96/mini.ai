import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { PROVIDER_LABELS, targetKey, type Provider } from '../../lib/chat'
import { listAgents, type Agent } from '../../lib/agents'
import { listModels, type ModelInfo } from '../../lib/providers'

const inputClasses =
  'rounded-sm border border-rail-border bg-input px-2 py-1.5 font-body text-sm text-on-surface disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]'

/** Live model list for `provider`, refetched whenever it changes. `status`
 * distinguishes "still loading" (disable Add, don't let "Loading…" become a
 * model id) from "no live list" (fall back to manual entry) from "got some". */
function useProviderModels(provider: Provider | '') {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    if (!provider) {
      setModels([])
      setStatus('unavailable')
      return
    }
    let cancelled = false
    setStatus('loading')
    setModels([])
    listModels(provider)
      .then((fetched) => {
        if (cancelled) return
        if (fetched.length === 0) {
          setStatus('unavailable')
        } else {
          setModels([...fetched].sort((a, b) => a.id.localeCompare(b.id)))
          setStatus('ready')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [provider])

  return { models, status }
}

/** Model picker for the add-target form: a live `<select>` when the
 * provider's key supports listing models, else the free-text fallback --
 * shared between raw and agent mode since the picking logic is identical. */
function ModelField({ provider, model, onChange }: { provider: Provider | ''; model: string; onChange: (m: string) => void }) {
  const { models, status } = useProviderModels(provider)

  if (status === 'loading') {
    return (
      <select aria-label="Model" disabled className={clsx(inputClasses, 'min-w-40 flex-1')}>
        <option>Loading models…</option>
      </select>
    )
  }

  if (status === 'ready') {
    return (
      <select
        aria-label="Model"
        value={model}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(inputClasses, 'min-w-40 flex-1')}
      >
        <option value="">Select model…</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1">
      <input
        aria-label="Model name"
        placeholder="model name, e.g. gemini-2.5-flash"
        value={model}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(inputClasses, 'placeholder:text-on-surface-low')}
      />
      <span className="font-body text-[11px] text-on-surface-low">
        Model list unavailable for this provider — enter manually.
      </span>
    </div>
  )
}

/** Each entry in the header picker's target list is either a raw
 * provider/model pair or an agent explicitly paired with its own
 * provider/model (an agent has no model of its own -- same reason a raw
 * target requires one). Raw and agent targets never mix: which kind is in
 * play is decided by Composer's "Agent mode" toggle, lifted in Home.tsx. */
export type ComposerTarget =
  | { kind: 'raw'; provider: Provider; model: string; enabled: boolean }
  | { kind: 'agent'; agentId: string; agentName: string; provider: Provider; model: string; enabled: boolean }

function targetLabel(t: ComposerTarget): string {
  return t.kind === 'agent'
    ? `Agent ${t.agentName} · ${PROVIDER_LABELS[t.provider]} · ${t.model}`
    : `${PROVIDER_LABELS[t.provider]} · ${t.model}`
}

// Only targets the user has actually checked on count as "selected" -- a
// configured-but-unchecked target stays in the list (so its provider/model
// survives a re-check) but shouldn't inflate the summary or gate sends.
function triggerLabel(agentMode: boolean, targets: ComposerTarget[]): string {
  const enabled = targets.filter((t) => t.enabled)
  if (enabled.length === 0) return agentMode ? 'Choose agents' : 'Choose models'
  const names = enabled.map((t) => (t.kind === 'agent' ? t.agentName : t.model))
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

interface TargetPickerProps {
  activeProviders: Provider[]
  agentMode: boolean
  targets: ComposerTarget[]
  onAdd: (target: ComposerTarget) => void
  onToggleEnabled: (index: number, enabled: boolean) => void
  onRemove: (index: number) => void
}

/** Top-of-pane pill + popover: picks raw provider/model targets when Agent
 * mode is off, or deployed agents (each paired with its own provider/model)
 * when it's on. Replaces the old in-composer "Select targets" popover --
 * same add-form/checked-list interaction, just relocated and mode-scoped. */
export function TargetPicker({
  activeProviders,
  agentMode,
  targets,
  onAdd,
  onToggleEnabled,
  onRemove,
}: TargetPickerProps) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<Provider | ''>(activeProviders[0] ?? '')
  const [model, setModel] = useState('')
  const [agentId, setAgentId] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])

  useEffect(() => {
    listAgents()
      .then((all) => setAgents(all.filter((a) => a.is_deployed)))
      .catch(() => setAgents([]))
  }, [])

  function resetForm() {
    setProvider(activeProviders[0] ?? '')
    setModel('')
    setAgentId('')
  }

  function confirmAdd() {
    if (!provider || !model.trim()) return
    const m = model.trim()
    if (agentMode) {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return
      onAdd({ kind: 'agent', agentId: agent.id, agentName: agent.name, provider, model: m, enabled: true })
    } else {
      onAdd({ kind: 'raw', provider, model: m, enabled: true })
    }
    setModel('')
    setAgentId('')
  }

  const addDisabled = !model.trim() || !provider || (agentMode && !agentId)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) resetForm()
      }}
    >
      <PopoverTrigger
        data-testid="target-picker-trigger"
        className={clsx(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1',
          'font-display text-[11px] font-medium uppercase tracking-[0.03em] transition-colors duration-150',
          'border-rail-border bg-rail-elevated text-on-surface-mid hover:text-on-surface',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
          'data-[state=open]:border-primary data-[state=open]:text-on-surface',
        )}
      >
        {triggerLabel(agentMode, targets)}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-wrap items-center gap-2">
          {agentMode && (
            <select
              aria-label="Agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={inputClasses}
            >
              <option value="">Select agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as Provider)
              setModel('')
            }}
            className={inputClasses}
          >
            {activeProviders.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
          <ModelField provider={provider} model={model} onChange={setModel} />
          <Button variant="secondary" onClick={confirmAdd} disabled={addDisabled}>
            Add
          </Button>
        </div>

        {targets.length > 0 && (
          <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {targets.map((t, i) => (
              <li
                key={`${t.kind}-${t.kind === 'agent' ? t.agentId : ''}-${targetKey(t.provider, t.model)}-${i}`}
                className="flex items-center gap-1 rounded-sm px-1 py-1 transition-colors duration-150 hover:bg-rail-elevated"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <Checkbox
                    checked={t.enabled}
                    onCheckedChange={(checked) => onToggleEnabled(i, checked === true)}
                    aria-label={`Use ${targetLabel(t)}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-body text-xs text-on-surface-mid">
                    {targetLabel(t)}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`Remove ${targetLabel(t)} from list`}
                  className={clsx(
                    'shrink-0 rounded-sm p-1 text-on-surface-low transition-colors duration-150',
                    'hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
