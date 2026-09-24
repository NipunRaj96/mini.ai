import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Pill } from '../components/ui/Pill'
import { ApiError } from '../lib/api'
import { PROVIDER_LABELS } from '../lib/chat'
import { addKey, deleteKey, listKeys, setKeyActive, type ApiKey, type Provider } from '../lib/keys'
import { addMcpServer, deleteMcpServer, listMcpServers, updateMcpServer, type McpServer } from '../lib/mcpServers'
import {
  addMemory,
  deleteMemory,
  getMemorySettings,
  listMemories,
  updateMemorySettings,
  type Memory,
} from '../lib/memory'
import { getUsageEvents, getUsageSummary, type UsageEvent, type UsageSummary } from '../lib/usage'

const PROVIDERS = Object.keys(PROVIDER_LABELS) as Provider[]

const inputClasses =
  'w-full rounded-sm bg-input border border-rail-border px-3 py-2 font-body text-sm text-on-surface ' +
  'focus-visible:border-[#383b45] transition'

function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return `$${value.toFixed(4)}`
}

function KeysSection() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0])
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    listKeys()
      .then(setKeys)
      .catch(() => setKeys([]))
  }, [])

  async function handleToggle(key: ApiKey) {
    setListError(null)
    try {
      const updated = await setKeyActive(key.id, !key.is_active)
      setKeys((prev) => (prev ?? []).map((k) => (k.id === key.id ? updated : k)))
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to update key. Please try again.')
    }
  }

  async function handleDelete(key: ApiKey) {
    if (!window.confirm(`Delete "${key.label}"? This can't be undone.`)) return
    setListError(null)
    try {
      await deleteKey(key.id)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to delete key. Please try again.')
      return
    }
    setKeys((prev) => (prev ?? []).filter((k) => k.id !== key.id))
  }

  async function handleAdd() {
    setSaving(true)
    setSaveError(null)
    try {
      const created = await addKey(provider, label, apiKey)
      setKeys((prev) => [...(prev ?? []), created])
      setLabel('')
      setApiKey('')
      setFormOpen(false)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to add key. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-medium text-on-surface">Provider Keys</h2>
        <Button variant="secondary" onClick={() => setFormOpen((v) => !v)}>
          + Add Key
        </Button>
      </div>

      {listError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {listError}
        </p>
      )}

      {formOpen && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-rail-border/70 bg-surface p-4">
          <div>
            <label
              htmlFor="key-provider"
              className="mb-1.5 block font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid"
            >
              Provider
            </label>
            <select
              id="key-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className={inputClasses}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input label="API Key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          {saveError && (
            <p role="alert" className="font-body text-xs text-error">
              {saveError}
            </p>
          )}
          <div>
            <Button onClick={() => void handleAdd()} disabled={!label || !apiKey} loading={saving}>
              Add
            </Button>
          </div>
        </div>
      )}

      {keys === null ? (
        <p className="font-body text-sm text-on-surface-mid">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="font-body text-sm text-on-surface-mid">No provider keys yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-rail-border/70 bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 font-display text-sm font-medium text-on-surface">{PROVIDER_LABELS[k.provider]}</span>
                <span className="min-w-0 truncate font-body text-xs text-on-surface-mid">{k.label}</span>
                <span className="shrink-0 font-mono text-xs text-on-surface-low">{k.masked_key}</span>
                <Pill live={k.is_active} className="shrink-0">{k.is_active ? 'Active' : 'Inactive'}</Pill>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleToggle(k)}
                  className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid transition-colors duration-150 hover:text-on-surface"
                >
                  {k.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${k.label}`}
                  onClick={() => void handleDelete(k)}
                  className="rounded-sm px-1.5 py-1 font-body text-on-surface-low transition-colors duration-150 hover:text-error"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function McpServersSection() {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionUrl, setConnectionUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    listMcpServers()
      .then(setServers)
      .catch(() => setServers([]))
  }, [])

  async function handleToggle(server: McpServer) {
    setListError(null)
    try {
      const updated = await updateMcpServer(server.id, { is_active: !server.is_active })
      setServers((prev) => (prev ?? []).map((s) => (s.id === server.id ? updated : s)))
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to update server. Please try again.')
    }
  }

  async function handleDelete(server: McpServer) {
    if (!window.confirm(`Delete "${server.name}"? This can't be undone.`)) return
    setListError(null)
    try {
      await deleteMcpServer(server.id)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to delete server. Please try again.')
      return
    }
    setServers((prev) => (prev ?? []).filter((s) => s.id !== server.id))
  }

  async function handleAdd() {
    setSaving(true)
    setSaveError(null)
    try {
      const created = await addMcpServer(name, connectionUrl, token || undefined)
      setServers((prev) => [...(prev ?? []), created])
      setName('')
      setConnectionUrl('')
      setToken('')
      setFormOpen(false)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to add server. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-medium text-on-surface">MCP Servers</h2>
        <Button variant="secondary" onClick={() => setFormOpen((v) => !v)}>
          + Add MCP Server
        </Button>
      </div>

      {listError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {listError}
        </p>
      )}

      {formOpen && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-rail-border/70 bg-surface p-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Connection URL" value={connectionUrl} onChange={(e) => setConnectionUrl(e.target.value)} />
          <Input label="Token (optional)" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          {saveError && (
            <p role="alert" className="font-body text-xs text-error">
              {saveError}
            </p>
          )}
          <div>
            <Button onClick={() => void handleAdd()} disabled={!name || !connectionUrl} loading={saving}>
              Add
            </Button>
          </div>
        </div>
      )}

      {servers === null ? (
        <p className="font-body text-sm text-on-surface-mid">Loading…</p>
      ) : servers.length === 0 ? (
        <p className="font-body text-sm text-on-surface-mid">No MCP servers yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-rail-border/70 bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 shrink truncate font-display text-sm font-medium text-on-surface">{s.name}</span>
                <span className="min-w-0 shrink truncate font-mono text-xs text-on-surface-mid">{s.connection_url}</span>
                <span className="shrink-0 font-body text-xs text-on-surface-low">{s.has_token ? 'Token set' : 'No token'}</span>
                <Pill live={s.is_active} className="shrink-0">{s.is_active ? 'Active' : 'Inactive'}</Pill>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleToggle(s)}
                  className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid transition-colors duration-150 hover:text-on-surface"
                >
                  {s.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => void handleDelete(s)}
                  className="rounded-sm px-1.5 py-1 font-body text-on-surface-low transition-colors duration-150 hover:text-error"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UsageSection() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [events, setEvents] = useState<UsageEvent[] | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)

  useEffect(() => {
    getUsageSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(err instanceof ApiError ? err.message : 'Failed to load usage summary.'))
    getUsageEvents(50)
      .then(setEvents)
      .catch((err) => setEventsError(err instanceof ApiError ? err.message : 'Failed to load usage events.'))
  }, [])

  return (
    <section>
      <h2 className="mb-3 font-display text-[15px] font-medium text-on-surface">Usage</h2>

      {summaryError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {summaryError}
        </p>
      )}

      {summary === null ? (
        !summaryError && <p className="font-body text-sm text-on-surface-mid">Loading…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-rail-border/70 bg-surface p-4">
              <p className="font-body text-xs text-on-surface-mid">Input Tokens</p>
              <p className="mt-1 font-display text-lg font-medium text-on-surface">
                {summary.total_input_tokens.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-rail-border/70 bg-surface p-4">
              <p className="font-body text-xs text-on-surface-mid">Output Tokens</p>
              <p className="mt-1 font-display text-lg font-medium text-on-surface">
                {summary.total_output_tokens.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-rail-border/70 bg-surface p-4">
              <p className="font-body text-xs text-on-surface-mid">Estimated Cost</p>
              <p className="mt-1 font-display text-lg font-medium text-on-surface">
                {formatUsd(summary.estimated_cost_usd)}
              </p>
            </div>
          </div>

          {summary.by_provider.length > 0 && (
            <table className="mb-6 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-rail-border/60">
                  <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Provider</th>
                  <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Input</th>
                  <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Output</th>
                  <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_provider.map((row) => (
                  <tr key={row.provider} className="border-b border-rail-border/60">
                    <td className="py-1.5 font-body text-sm text-on-surface">{PROVIDER_LABELS[row.provider]}</td>
                    <td className="py-1.5 font-body text-sm text-on-surface-mid">{row.input_tokens.toLocaleString()}</td>
                    <td className="py-1.5 font-body text-sm text-on-surface-mid">{row.output_tokens.toLocaleString()}</td>
                    <td className="py-1.5 font-body text-sm text-on-surface-mid">{formatUsd(row.estimated_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {eventsError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {eventsError}
        </p>
      )}

      {events === null ? (
        !eventsError && <p className="font-body text-sm text-on-surface-mid">Loading…</p>
      ) : events.length === 0 ? (
        <p className="font-body text-sm text-on-surface-mid">No usage events yet.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-rail-border/60">
              <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Provider</th>
              <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Model</th>
              <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Latency</th>
              <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Cost</th>
              <th className="py-1.5 font-body text-xs font-medium text-on-surface-mid">Date</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-rail-border/60">
                <td className="py-1.5 font-body text-sm text-on-surface">{PROVIDER_LABELS[event.provider]}</td>
                <td className="py-1.5 font-mono text-xs text-on-surface-mid">{event.model}</td>
                <td className="py-1.5 font-body text-sm text-on-surface-mid">{event.latency_ms}ms</td>
                <td className="py-1.5 font-body text-sm text-on-surface-mid">{formatUsd(event.cost_estimate_usd)}</td>
                <td className="py-1.5 font-body text-sm text-on-surface-mid">{new Date(event.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function MemorySection() {
  const [memories, setMemories] = useState<Memory[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    listMemories()
      .then(setMemories)
      .catch(() => setMemories([]))
    getMemorySettings()
      .then((s) => setEnabled(s.enabled))
      .catch((err) => setSettingsError(err instanceof ApiError ? err.message : 'Failed to load memory settings.'))
  }, [])

  async function handleToggleEnabled(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked
    setSettingsError(null)
    setEnabled(next)
    try {
      const updated = await updateMemorySettings(next)
      setEnabled(updated.enabled)
    } catch (err) {
      setEnabled(!next)
      setSettingsError(err instanceof ApiError ? err.message : 'Failed to update memory settings. Please try again.')
    }
  }

  async function handleDelete(memory: Memory) {
    if (!window.confirm('Delete this memory? This can\'t be undone.')) return
    setListError(null)
    try {
      await deleteMemory(memory.id)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to delete memory. Please try again.')
      return
    }
    setMemories((prev) => (prev ?? []).filter((m) => m.id !== memory.id))
  }

  async function handleAdd() {
    setSaving(true)
    setSaveError(null)
    try {
      const created = await addMemory(content)
      setMemories((prev) => [created, ...(prev ?? [])])
      setContent('')
      setFormOpen(false)
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to add memory. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-medium text-on-surface">Memory</h2>
        <Button variant="secondary" onClick={() => setFormOpen((v) => !v)}>
          + Add Memory
        </Button>
      </div>

      <p className="mb-3 font-body text-sm text-on-surface-mid">
        mini.ai can remember useful facts about you across conversations.
      </p>

      {settingsError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {settingsError}
        </p>
      )}

      <label className="mb-4 flex items-center gap-2 font-body text-xs text-on-surface-mid">
        <input type="checkbox" checked={enabled} onChange={(e) => void handleToggleEnabled(e)} />
        Remember things about me across conversations
      </label>

      {listError && (
        <p role="alert" className="mb-3 rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
          {listError}
        </p>
      )}

      {formOpen && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-rail-border/70 bg-surface p-4">
          <Input label="Memory" value={content} onChange={(e) => setContent(e.target.value)} />
          {saveError && (
            <p role="alert" className="font-body text-xs text-error">
              {saveError}
            </p>
          )}
          <div>
            <Button onClick={() => void handleAdd()} disabled={!content} loading={saving}>
              Add
            </Button>
          </div>
        </div>
      )}

      {memories === null ? (
        <p className="font-body text-sm text-on-surface-mid">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="font-body text-sm text-on-surface-mid">No memories yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-rail-border/70 bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 truncate font-body text-sm text-on-surface">{m.content}</span>
                <Pill className="shrink-0">{m.source === 'manual' ? 'Manual' : 'Auto'}</Pill>
              </div>
              <button
                type="button"
                aria-label={`Delete memory: ${m.content}`}
                onClick={() => void handleDelete(m)}
                className="shrink-0 rounded-sm px-1.5 py-1 font-body text-on-surface-low transition-colors duration-150 hover:text-error"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Settings() {
  const navigate = useNavigate()

  return (
    <div className="h-screen overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-4xl px-[var(--space-lg)] py-[var(--space-xl)]">
        <div className="mb-[var(--space-lg)] flex items-center justify-between">
          <h1 className="font-display text-xl font-medium text-on-surface">Settings</h1>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back to chat
          </Button>
        </div>

        <div className="flex flex-col gap-[var(--space-xl)]">
          <KeysSection />
          <McpServersSection />
          <MemorySection />
          <UsageSection />
        </div>
      </div>
    </div>
  )
}
