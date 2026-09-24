import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { ApiError } from '../lib/api'
import {
  createAgent,
  deleteAgent,
  updateAgent,
  listAgents,
  type Agent,
  type AgentInput,
  type OutputFormat,
} from '../lib/agents'
import { listKeys, PROVIDER_LABELS, type ApiKey } from '../lib/chat'
import { listMcpServers, type McpServer } from '../lib/mcpServers'

const OUTPUT_FORMATS: Array<{ value: OutputFormat; label: string }> = [
  { value: 'structured_markdown', label: 'Structured Markdown' },
  { value: 'strict_json', label: 'Strict JSON Schema' },
  { value: 'executive_brief', label: 'Executive Brief' },
  { value: 'custom', label: 'Custom' },
]

const ALLOWED_TOOLS: Array<{ value: string; label: string }> = [
  { value: 'web_search', label: 'Web search' },
  { value: 'docs', label: 'Docs' },
]

interface FormState {
  name: string
  role: string
  primaryGoal: string
  guardrailsText: string
  outputFormat: OutputFormat
  outputInstructions: string
  jsonSchemaText: string
  allowedTools: string[]
  mcpServerIds: string[]
}

function emptyForm(): FormState {
  return {
    name: '',
    role: '',
    primaryGoal: '',
    guardrailsText: '',
    outputFormat: 'structured_markdown',
    outputInstructions: '',
    jsonSchemaText: '',
    allowedTools: [],
    mcpServerIds: [],
  }
}

function formFromAgent(agent: Agent): FormState {
  return {
    name: agent.name,
    role: agent.role,
    primaryGoal: agent.primary_goal,
    guardrailsText: agent.guardrail_patterns.join('\n'),
    outputFormat: agent.output_format,
    outputInstructions: agent.output_instructions ?? '',
    jsonSchemaText: agent.json_schema ? JSON.stringify(agent.json_schema, null, 2) : '',
    allowedTools: agent.allowed_tools,
    mcpServerIds: agent.mcp_server_ids,
  }
}

const inputClasses =
  'w-full rounded-sm bg-input border border-[#22242b] px-3.5 py-2 text-[13px] text-on-surface ' +
  'placeholder-on-surface-low focus:border-[#383b45] focus:outline-none transition'

export function AgentConsole() {
  const navigate = useNavigate()

  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])

  const [panelOpen, setPanelOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm())
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [jsonSchemaError, setJsonSchemaError] = useState<string | null>(null)

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
    listKeys()
      .then(setKeys)
      .catch(() => setKeys([]))
    listMcpServers()
      .then(setMcpServers)
      .catch(() => setMcpServers([]))
  }, [])

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm])

  function openNew() {
    setEditingAgent(null)
    const next = emptyForm()
    setForm(next)
    setInitialForm(next)
    setSaveError(null)
    setSaved(false)
    setJsonSchemaError(null)
    setMcpPickerOpen(false)
    setPanelOpen(true)
  }

  function openEdit(agent: Agent) {
    setEditingAgent(agent)
    const next = formFromAgent(agent)
    setForm(next)
    setInitialForm(next)
    setSaveError(null)
    setSaved(false)
    setJsonSchemaError(null)
    setMcpPickerOpen(false)
    setPanelOpen(true)
  }

  function closePanel() {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    setPanelOpen(false)
  }

  async function handleDelete(agent: Agent) {
    if (!window.confirm(`Delete "${agent.name}"? This can't be undone.`)) return
    setListError(null)
    try {
      await deleteAgent(agent.id)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Failed to delete agent. Please try again.')
      return
    }
    setAgents((prev) => (prev ?? []).filter((a) => a.id !== agent.id))
    if (editingAgent?.id === agent.id) setPanelOpen(false)
  }

  function buildPayload(): AgentInput | null {
    setJsonSchemaError(null)
    let json_schema: object | null = null
    if (form.jsonSchemaText.trim()) {
      try {
        json_schema = JSON.parse(form.jsonSchemaText)
      } catch {
        setJsonSchemaError('Invalid JSON')
        return null
      }
    }
    return {
      name: form.name,
      role: form.role,
      primary_goal: form.primaryGoal,
      output_format: form.outputFormat,
      output_instructions: form.outputFormat === 'custom' && form.outputInstructions.trim() ? form.outputInstructions : null,
      json_schema,
      guardrail_patterns: form.guardrailsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      allowed_tools: form.allowedTools,
      mcp_server_ids: form.mcpServerIds,
    }
  }

  async function handleSave(isDeployed: boolean, navigateHomeAfter = false): Promise<Agent | null> {
    const payload = buildPayload()
    if (!payload) return null
    setSaving(true)
    setSaveError(null)
    try {
      const body = { ...payload, is_deployed: isDeployed }
      // The backend's create endpoint (CreateAgentRequest) has no is_deployed
      // field -- it's silently ignored on POST, only PATCH accepts it. So
      // deploying a brand-new agent needs create-then-patch as one action,
      // otherwise a single "Deploy Agent" click on a new agent would land
      // as a draft and require a second click to actually deploy.
      let result = editingAgent ? await updateAgent(editingAgent.id, body) : await createAgent(body)
      if (!editingAgent && isDeployed) {
        result = await updateAgent(result.id, { is_deployed: true })
      }
      setAgents((prev) => {
        const list = prev ?? []
        return list.some((a) => a.id === result.id)
          ? list.map((a) => (a.id === result.id ? result : a))
          : [result, ...list]
      })
      setEditingAgent(result)
      const next = formFromAgent(result)
      setForm(next)
      setInitialForm(next)
      setSaved(true)
      if (navigateHomeAfter) {
        setPanelOpen(false)
        navigate('/')
      }
      return result
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const activeKeys = keys.filter((k) => k.is_active)
  const availableMcpServers = mcpServers.filter((s) => s.is_active && !form.mcpServerIds.includes(s.id))
  const selectedMcpServers = mcpServers.filter((s) => form.mcpServerIds.includes(s.id))

  // Prefer browser-history back (restores whatever chat URL -- /c/<id> or /
  // -- was open before the user clicked in) over a hardcoded '/', which
  // would drop the conversation they'd been on. Falls back to '/' when
  // there's no prior in-app entry to go back to, e.g. a direct link/refresh.
  function handleBackToChat() {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="relative h-screen bg-canvas">
      <div className="mx-auto max-w-4xl px-[var(--space-lg)] py-[var(--space-xl)]">
        <div className="mb-[var(--space-lg)] flex items-center justify-between">
          <h1 className="font-display text-xl font-medium text-on-surface">Agent Console</h1>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleBackToChat}>
              Back to chat
            </Button>
            <Button variant="primary" onClick={openNew}>
              + New Agent
            </Button>
          </div>
        </div>

        {listError && (
          <p role="alert" className="mb-[var(--space-md)] rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
            {listError}
          </p>
        )}

        {agents === null ? (
          <p className="font-body text-sm text-on-surface-mid">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="font-body text-sm text-on-surface-mid">No agents yet. Create one to get started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {agents.map((agent) => (
              <li key={agent.id} className="group relative">
                <button
                  type="button"
                  onClick={() => openEdit(agent)}
                  className="w-full rounded-lg border border-rail-border bg-surface px-[var(--space-md)] py-[var(--space-md)] pr-16 text-left transition-colors duration-150 hover:bg-rail-elevated"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="min-w-0 truncate font-display text-sm font-medium text-on-surface">{agent.name}</span>
                    {agent.is_deployed ? <Pill live className="shrink-0">Active</Pill> : <Pill className="shrink-0">Draft</Pill>}
                  </div>
                  <p className="mt-1 truncate font-body text-xs text-on-surface-mid">{agent.role}</p>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${agent.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(agent)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-1 font-body text-on-surface-low opacity-0 transition-opacity duration-150 hover:text-error group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {panelOpen && (
        <div
          className="absolute inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-[2px]"
          data-purpose="agent-console-overlay"
          onClick={closePanel}
        >
          <div
            className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-rail-border bg-[#111215] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-rail-border bg-[#131418]/60 px-6 py-5">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="font-display text-[15px] font-medium tracking-tight text-on-surface">Agent Console</h2>
                  <span className="rounded bg-[#1e2026] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent border border-accent/20">
                    {editingAgent ? (editingAgent.is_deployed ? 'Deployed' : 'Draft') : 'New Draft'}
                  </span>
                </div>
                <p className="mt-0.5 font-body text-[12px] text-on-surface-mid">
                  Configure custom autonomous agent with connected API keys &amp; MCPs
                </p>
              </div>
              <button
                type="button"
                title="Close Console"
                aria-label="Close Console"
                onClick={closePanel}
                className="rounded-lg p-1.5 text-on-surface-mid hover:bg-rail-hover hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-[13px]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="font-display text-[12px] font-medium uppercase tracking-wide text-on-surface-mid">
                    Connected Provider Keys
                  </label>
                  <span className="font-mono text-[11px] text-on-surface-mid">{activeKeys.length} Active Keys</span>
                </div>
                {activeKeys.length === 0 ? (
                  <p className="font-body text-[12px] text-on-surface-low">No active provider keys yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {activeKeys.map((k) => (
                      <div
                        key={k.id}
                        className="flex flex-col gap-1 rounded-xl border border-[#23252c] bg-surface p-2.5 transition hover:border-[#383b45]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-on-surface">{PROVIDER_LABELS[k.provider]}</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        </div>
                        <span className="truncate font-mono text-[11px] text-on-surface-mid">{k.masked_key}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-1">
                <div>
                  <label htmlFor="agent-name" className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid">
                    Agent Name
                  </label>
                  <input
                    id="agent-name"
                    type="text"
                    className={inputClasses}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="agent-role" className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid">
                    Agent Role
                  </label>
                  <input
                    id="agent-role"
                    type="text"
                    className={inputClasses}
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  />
                </div>
                <div>
                  <label
                    htmlFor="agent-primary-goal"
                    className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid"
                  >
                    Primary Goal
                  </label>
                  <textarea
                    id="agent-primary-goal"
                    rows={2}
                    className={`${inputClasses} resize-none leading-relaxed`}
                    value={form.primaryGoal}
                    onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
                  />
                </div>
                <div>
                  <label
                    htmlFor="agent-guardrails"
                    className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid"
                  >
                    Safety &amp; Execution Guardrails
                  </label>
                  <textarea
                    id="agent-guardrails"
                    rows={2}
                    placeholder="One pattern per line"
                    className={`${inputClasses} resize-none leading-relaxed`}
                    value={form.guardrailsText}
                    onChange={(e) => setForm((f) => ({ ...f, guardrailsText: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid">Output Format</label>
                  <div className="grid grid-cols-4 gap-2">
                    {OUTPUT_FORMATS.map((f) => {
                      const active = form.outputFormat === f.value
                      return (
                        <button
                          key={f.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setForm((prev) => ({ ...prev, outputFormat: f.value }))}
                          className={
                            active
                              ? 'flex items-center justify-center gap-1.5 rounded-lg border border-rail-border bg-rail-hover px-3 py-2 text-center text-[12px] font-medium text-on-surface'
                              : 'rounded-lg border border-[#22242b] bg-input px-3 py-2 text-center text-[12px] text-on-surface-mid transition hover:border-[#383b45] hover:text-on-surface'
                          }
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                  {form.outputFormat === 'custom' && (
                    <textarea
                      aria-label="Output instructions"
                      rows={2}
                      placeholder="Custom output instructions"
                      className={`${inputClasses} mt-2 resize-none leading-relaxed`}
                      value={form.outputInstructions}
                      onChange={(e) => setForm((f) => ({ ...f, outputInstructions: e.target.value }))}
                    />
                  )}
                  <div className="mt-2">
                    <label
                      htmlFor="agent-json-schema"
                      className="mb-1.5 block font-body text-[11px] text-on-surface-low"
                    >
                      JSON Schema (optional, raw JSON)
                    </label>
                    <textarea
                      id="agent-json-schema"
                      rows={3}
                      className={`${inputClasses} resize-none font-mono leading-relaxed`}
                      value={form.jsonSchemaText}
                      onChange={(e) => setForm((f) => ({ ...f, jsonSchemaText: e.target.value }))}
                    />
                    {jsonSchemaError && <p className="mt-1 font-body text-xs text-error">{jsonSchemaError}</p>}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block font-body text-[12px] font-medium text-on-surface-mid">Allowed Tools</label>
                  <div className="flex gap-4">
                    {ALLOWED_TOOLS.map((tool) => (
                      <label key={tool.value} className="flex items-center gap-1.5 font-body text-[12px] text-on-surface">
                        <input
                          type="checkbox"
                          checked={form.allowedTools.includes(tool.value)}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              allowedTools: e.target.checked
                                ? [...f.allowedTools, tool.value]
                                : f.allowedTools.filter((t) => t !== tool.value),
                            }))
                          }
                        />
                        {tool.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="font-body text-[12px] font-medium text-on-surface-mid">
                      Model Context Protocol (MCP) Servers
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedMcpServers.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rail-border bg-[#191a20] px-2.5 py-1 font-mono text-[11.5px] text-on-surface"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        {s.name}
                        <button
                          type="button"
                          aria-label={`Remove ${s.name}`}
                          onClick={() =>
                            setForm((f) => ({ ...f, mcpServerIds: f.mcpServerIds.filter((id) => id !== s.id) }))
                          }
                          className="text-on-surface-mid hover:text-on-surface"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMcpPickerOpen((v) => !v)}
                      className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid hover:text-primary"
                    >
                      + Add MCP
                    </button>
                  </div>
                  {mcpPickerOpen && (
                    <div className="mt-2 flex flex-col gap-1 rounded-lg border border-rail-border bg-surface p-2">
                      {availableMcpServers.length === 0 ? (
                        <p className="px-2 py-1 font-body text-[12px] text-on-surface-low">No more saved MCP servers.</p>
                      ) : (
                        availableMcpServers.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setForm((f) => ({ ...f, mcpServerIds: [...f.mcpServerIds, s.id] }))
                              setMcpPickerOpen(false)
                            }}
                            className="rounded-sm px-2 py-1 text-left font-body text-[12px] text-on-surface hover:bg-rail-elevated"
                          >
                            {s.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {saveError && (
                <p role="alert" className="rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
                  {saveError}
                </p>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center justify-between border-t border-rail-border bg-[#131418] p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave(false)}
                  className="rounded-lg border border-rail-border bg-[#1c1d22] px-3 py-1.5 text-[12.5px] font-medium text-on-surface-mid transition hover:bg-rail-hover hover:text-on-surface disabled:opacity-50"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave(false, true)}
                  className="text-[12.5px] font-medium text-on-surface-mid transition hover:text-on-surface disabled:opacity-50"
                >
                  {/* TODO(Task 2): pre-select this agent as a single agent_id target in
                      the composer instead of just landing on a clean chat home. */}
                  Test in Chat
                </button>
                {saved && !isDirty && <span className="font-body text-[12px] text-on-surface-low">Saved</span>}
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(true)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[12.5px] font-medium text-on-primary shadow-sm transition hover:bg-primary-hover disabled:opacity-50"
              >
                Deploy Agent →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
