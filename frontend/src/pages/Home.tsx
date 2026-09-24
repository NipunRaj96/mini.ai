import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '../components/chat/Sidebar'
import { MessageStream, type StreamBlock } from '../components/chat/MessageStream'
import { Composer } from '../components/chat/Composer'
import { TargetPicker, type ComposerTarget } from '../components/chat/TargetPicker'
import { useAuth } from '../lib/auth'
import {
  createConversation,
  deleteConversation,
  listConversations,
  listKeys,
  listMessages,
  sendMessage,
  targetKey,
  type AgentTarget,
  type ApiKey,
  type ChatMessage,
  type Conversation,
  type Provider,
  type ResearchStepData,
  type Target,
  type ToolCallData,
} from '../lib/chat'

function optimisticUserMessage(content: string): ChatMessage {
  return {
    id: `optimistic-${Date.now()}`,
    role: 'user',
    content,
    provider: null,
    model: null,
    request_group_id: null,
    created_at: new Date().toISOString(),
  }
}

/** Same-key targets collapse into one live block — see chat.ts's targetKey
 * note. Raw and agent-tagged targets both stream deltas keyed the same way
 * (provider+model), so they're flattened together here. */
function initialStreamBlocks(raw: Target[], agentTargets: AgentTarget[]): StreamBlock[] {
  const blocks: StreamBlock[] = []
  const seen = new Set<string>()
  for (const t of [...raw, ...agentTargets]) {
    const key = targetKey(t.provider, t.model)
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push({ key, provider: t.provider, model: t.model, text: '' })
  }
  return blocks
}

export function Home() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  // The active conversation's identity lives in the URL (ChatGPT's /c/<id>
  // pattern), not local state -- so navigating away to /agents and back via
  // browser history restores it instead of losing it to a Home remount.
  const { conversationId } = useParams<{ conversationId?: string }>()
  const activeId = conversationId ?? null

  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const [streaming, setStreaming] = useState(false)
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null)
  const [streamBlocks, setStreamBlocks] = useState<StreamBlock[]>([])
  const [researchSteps, setResearchSteps] = useState<ResearchStepData[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCallData[]>([])
  // Per-browser-session only -- not persisted to the backend or scoped per
  // conversation. Checking a doc here is what turns use_docs grounding on
  // (see handleSend below); there's no separate composer toggle for it anymore.
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Lifted from Composer so the header's TargetPicker and the composer's
  // Agent Mode toggle can both read/drive the same selection. Raw and agent
  // targets are mutually exclusive per turn -- toggleAgentMode below clears
  // whichever kind belongs to the mode being left.
  const [targets, setTargets] = useState<ComposerTarget[]>([])
  const [agentMode, setAgentMode] = useState(false)
  const [synthesize, setSynthesize] = useState(false)

  useEffect(() => {
    listKeys()
      .then(setKeys)
      .catch(() => setKeys([]))
    listConversations()
      .then(setConversations)
      .catch(() => setConversations([]))
  }, [])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    listMessages(activeId)
      .then(setMessages)
      .catch(() => setMessages([]))
  }, [activeId])

  const activeProviders = useMemo(() => {
    if (!keys) return []
    const seen = new Set<Provider>()
    for (const k of keys) if (k.is_active) seen.add(k.provider)
    return [...seen]
  }, [keys])
  const noActiveKeys = keys !== null && activeProviders.length === 0

  async function handleNewConversation() {
    const conv = await createConversation()
    setConversations((prev) => [conv, ...prev])
    navigate(`/c/${conv.id}`)
  }

  async function handleDeleteConversation(id: string) {
    await deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) navigate('/')
  }

  function addTarget(target: ComposerTarget) {
    setTargets((prev) => [...prev, target])
  }

  // Unchecking a row only flips `enabled` -- the target stays configured
  // (provider/model intact) so re-checking it doesn't force retyping.
  function toggleTargetEnabled(index: number, enabled: boolean) {
    setTargets((prev) => prev.map((t, i) => (i === index ? { ...t, enabled } : t)))
  }

  // The only action that actually splices a target out of the list.
  function removeTarget(index: number) {
    setTargets((prev) => prev.filter((_, i) => i !== index))
  }

  // Raw and agent targets are mutually exclusive per turn, sharing the one
  // header TargetPicker whose content depends on this toggle -- switching
  // clears whatever was selected under the mode being left, so a stale
  // cross-mode selection can never silently ride along into a send.
  function toggleAgentMode() {
    setAgentMode((prev) => {
      const next = !prev
      setTargets((ts) => ts.filter((t) => t.kind === (next ? 'agent' : 'raw')))
      return next
    })
  }

  async function handleSend(content: string, opts: { useWebSearch: boolean; useDeepResearch: boolean }) {
    let convId = activeId
    if (!convId) {
      const conv = await createConversation()
      convId = conv.id
      setConversations((prev) => [conv, ...prev])
      navigate(`/c/${conv.id}`)
    }

    // A configured-but-unchecked target must never ride along into the
    // actual request -- only `enabled` rows count as "selected" for send.
    const enabledTargets = targets.filter((t) => t.enabled)
    const raw: Target[] = enabledTargets
      .filter((t): t is Extract<ComposerTarget, { kind: 'raw' }> => t.kind === 'raw')
      .map((t) => ({ provider: t.provider, model: t.model }))
    const agentTargets: AgentTarget[] = enabledTargets
      .filter((t): t is Extract<ComposerTarget, { kind: 'agent' }> => t.kind === 'agent')
      .map((t) => ({ agent_id: t.agentId, provider: t.provider, model: t.model }))
    const synthesizeEligible = activeProviders.length >= 3

    setStreamBlocks(initialStreamBlocks(raw, agentTargets))
    setResearchSteps([])
    setToolCalls([])
    setStreamingConvId(convId)
    setStreaming(true)
    setMessages((prev) => [...prev, optimisticUserMessage(content)])

    // The backend 400s use_docs (and web-search/deep-research) alongside
    // agent_targets -- an agent's own allowed_tools is authoritative there
    // instead, same reason Composer already forces its other two toggles off
    // once an agent is tagged.
    const useDocs = selectedDocIds.length > 0 && agentTargets.length === 0

    try {
      await sendMessage(
        convId,
        content,
        {
          targets: raw,
          agentTargets,
          synthesize: agentMode && synthesize && enabledTargets.length >= 2 && synthesizeEligible,
          useDocs,
          useWebSearch: opts.useWebSearch,
          useDeepResearch: opts.useDeepResearch,
          documentIds: useDocs ? selectedDocIds : undefined,
        },
        (delta) => {
          const key = targetKey(delta.provider, delta.model)
          setStreamBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, text: b.text + delta.text } : b)))
        },
        async () => {
          const [msgs, convs] = await Promise.all([listMessages(convId!), listConversations()])
          setMessages(msgs)
          setConversations(convs)
        },
        (step) => setResearchSteps((prev) => [...prev, step]),
        (call) => setToolCalls((prev) => [...prev, call]),
      )
    } catch (err) {
      console.error('Send failed', err)
    } finally {
      setStreaming(false)
      setStreamingConvId(null)
      setStreamBlocks([])
      setResearchSteps([])
      setToolCalls([])
    }
  }

  // Only show this turn's live blocks while its own conversation is active —
  // otherwise a background stream would visually bleed into a chat the user
  // switched to.
  const visibleStreamBlocks = streaming && streamingConvId === activeId ? streamBlocks : []
  const visibleResearchSteps = streaming && streamingConvId === activeId ? researchSteps : []
  const visibleToolCalls = streaming && streamingConvId === activeId ? toolCalls : []

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        user={user}
        onSelect={(id) => navigate(`/c/${id}`)}
        onNew={() => void handleNewConversation()}
        onDelete={(id) => void handleDeleteConversation(id)}
        onLogout={() => void logout()}
        selectedDocIds={selectedDocIds}
        onSelectedDocsChange={setSelectedDocIds}
        collapsed={!sidebarOpen}
        onToggleCollapse={() => setSidebarOpen((v) => !v)}
      />
      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {!noActiveKeys && (
          <div className="flex items-center justify-end border-b border-rail-border/60 px-[var(--space-md)] py-[var(--space-sm)]">
            <TargetPicker
              activeProviders={activeProviders}
              agentMode={agentMode}
              targets={targets}
              onAdd={addTarget}
              onToggleEnabled={toggleTargetEnabled}
              onRemove={removeTarget}
            />
          </div>
        )}
        <MessageStream
          messages={messages}
          streamBlocks={visibleStreamBlocks}
          researchSteps={visibleResearchSteps}
          toolCalls={visibleToolCalls}
          isEmpty={!activeId && messages.length === 0 && visibleStreamBlocks.length === 0}
          onStartFirst={() => void handleNewConversation()}
        />
        <Composer
          activeProviders={activeProviders}
          noActiveKeys={noActiveKeys}
          streaming={streaming}
          targets={targets}
          agentMode={agentMode}
          onToggleAgentMode={toggleAgentMode}
          synthesize={synthesize}
          onSynthesizeChange={setSynthesize}
          onSend={handleSend}
        />
      </div>
    </div>
  )
}
