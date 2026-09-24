/**
 * Chat + keys API: conversations, messages, and the streaming send.
 * Thin wrappers over apiFetch/streamSSE — no extra state or caching here,
 * that lives in the Home page that calls these.
 */
import { apiFetch } from './api'
import { streamSSE } from './sse'

export type Provider =
  | 'google_ai_studio'
  | 'groq'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'tavily'
  | 'huggingface'

export const PROVIDER_LABELS: Record<Provider, string> = {
  google_ai_studio: 'Google AI Studio',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  tavily: 'Tavily',
  huggingface: 'Hugging Face',
}

export interface ApiKey {
  id: string
  provider: Provider
  label: string
  masked_key: string
  is_active: boolean
  created_at: string
}

export interface Conversation {
  id: string
  title: string | null
  updated_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  provider: Provider | null
  model: string | null
  request_group_id: string | null
  created_at: string
}

export interface Target {
  provider: Provider
  model: string
}

/** One tagged agent bound explicitly to its own provider/model — mirrors the
 * backend's AgentTarget (app/modules/chat/schemas.py): an agent has no model
 * of its own, so the caller states the pairing directly. Field is snake_case
 * to match the wire body exactly, no case conversion needed at the call site. */
export interface AgentTarget {
  agent_id: string
  provider: Provider
  model: string
}

export function listKeys(): Promise<ApiKey[]> {
  return apiFetch<ApiKey[]>('/api/v1/keys')
}

export function listConversations(): Promise<Conversation[]> {
  return apiFetch<Conversation[]>('/api/v1/chat/conversations')
}

export async function createConversation(): Promise<Conversation> {
  // The create endpoint's response is {id, title, created_at} -- no
  // updated_at (that's only on the list endpoint's ConversationSummary).
  // Synthesize it from created_at, which is factually correct for a
  // brand-new conversation, so callers always get a real Conversation.
  const created = await apiFetch<{ id: string; title: string | null; created_at: string }>(
    '/api/v1/chat/conversations',
    { method: 'POST' },
  )
  return { id: created.id, title: created.title, updated_at: created.created_at }
}

export function deleteConversation(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/chat/conversations/${id}`, { method: 'DELETE' })
}

export function listMessages(conversationId: string): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/api/v1/chat/conversations/${conversationId}/messages`)
}

export interface DeltaData {
  provider: Provider
  model: string
  text: string
}

export interface DoneData {
  conversation_id: string
}

/** Combines provider+model into the key used to route a delta to its block.
 * Two targets sharing a (provider, model) pair collapse onto the same key —
 * intentional: the SSE payload can't disambiguate which physical target a
 * chunk belongs to in that case, so they render as one combined stream. */
export function targetKey(provider: string, model: string): string {
  return `${provider}::${model}`
}

export interface SendMessageOptions {
  targets?: Target[]
  agentTargets?: AgentTarget[]
  synthesize?: boolean
  useDocs?: boolean
  useWebSearch?: boolean
  useDeepResearch?: boolean
  /** Scopes use_docs' search to these document ids (the sidebar's Docs
   * checklist) -- mirrors the backend's SendMessageRequest.document_ids. */
  documentIds?: string[]
}

/** One round of the backend's bounded deep-research loop (see
 * app/modules/chat/deep_research.py's DeepResearchStep) -- streamed live via
 * `event: research_step`, interleaved before the final answer's deltas. */
export interface ResearchStepData {
  round: number
  query: string
  sources_found: string[]
}

/** One agentic tool call the model made mid-turn (web_search / search_docs /
 * deep_research) -- streamed live via `event: tool_call`, the same way
 * ResearchStepData rides `event: research_step`. `arguments` is opaque JSON
 * (shape depends on the tool), so consumers read out of it defensively. */
export interface ToolCallData {
  name: string
  arguments: Record<string, unknown>
}

export function sendMessage(
  conversationId: string,
  content: string,
  options: SendMessageOptions,
  onDelta: (data: DeltaData) => void,
  onDone: (data: DoneData) => void,
  onResearchStep?: (data: ResearchStepData) => void,
  onToolCall?: (data: ToolCallData) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Lean body, mirroring the backend's optional fields -- an empty/omitted
  // key for the kind of target not in play, never `targets: []` alongside
  // `agent_targets`, since a single request carries one kind or a deliberate
  // mix of both (see chat/router.py's _send_multi_agent_message).
  const body: {
    content: string
    targets?: Target[]
    agent_targets?: AgentTarget[]
    synthesize?: boolean
    use_docs?: boolean
    use_web_search?: boolean
    use_deep_research?: boolean
    document_ids?: string[]
  } = { content }
  if (options.targets?.length) body.targets = options.targets
  if (options.agentTargets?.length) body.agent_targets = options.agentTargets
  if (options.synthesize) body.synthesize = true
  if (options.useDocs) body.use_docs = true
  if (options.useWebSearch) body.use_web_search = true
  if (options.useDeepResearch) body.use_deep_research = true
  if (options.documentIds?.length) body.document_ids = options.documentIds

  return streamSSE(
    `/api/v1/chat/conversations/${conversationId}/messages`,
    body,
    (event, data) => {
      if (event === 'delta') onDelta(JSON.parse(data) as DeltaData)
      else if (event === 'done') onDone(JSON.parse(data) as DoneData)
      else if (event === 'research_step' && onResearchStep) onResearchStep(JSON.parse(data) as ResearchStepData)
      else if (event === 'tool_call' && onToolCall) onToolCall(JSON.parse(data) as ToolCallData)
    },
    signal,
  )
}
