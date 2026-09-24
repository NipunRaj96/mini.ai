import clsx from 'clsx'
import { FileText, Link as LinkIcon, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Parent, Root, Text } from 'mdast'
import ReactMarkdown from 'react-markdown'
import { visit } from 'unist-util-visit'
import { PROVIDER_LABELS, type ChatMessage, type Provider, type ResearchStepData, type ToolCallData } from '../../lib/chat'

/** router.py's `_format_source_citation` makes the model reproduce document/web
 * citations verbatim as literal `[source: ...]` bracket text in its markdown --
 * matches both `[source: filename.pdf, page 3]` and `[source: https://...]`.
 * This remark plugin (unist-util-visit is already a transitive dep of
 * react-markdown's remark/unified toolchain, so no new package.json entry)
 * rewrites matches in text nodes into `span` nodes carrying the citation value
 * as a hast data attribute, picked up by the `span` entry in MarkdownText's
 * `components` below and rendered as a pill instead of plain text. Streaming
 * text before the closing `]` arrives simply doesn't match yet -- same
 * tolerance as the rest of this file's markdown-mid-stream handling. */
const CITATION_RE = /\[source:\s*([^\]]+)\]/g

function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | null | undefined) => {
      if (parent == null || index == null) return
      CITATION_RE.lastIndex = 0
      if (!CITATION_RE.test(node.value)) return
      CITATION_RE.lastIndex = 0

      const replacement: Array<Text | ReturnType<typeof citationNode>> = []
      let lastEnd = 0
      let match: RegExpExecArray | null
      while ((match = CITATION_RE.exec(node.value))) {
        if (match.index > lastEnd) {
          replacement.push({ type: 'text', value: node.value.slice(lastEnd, match.index) })
        }
        replacement.push(citationNode(match[1].trim()))
        lastEnd = match.index + match[0].length
      }
      if (lastEnd < node.value.length) {
        replacement.push({ type: 'text', value: node.value.slice(lastEnd) })
      }

      parent.children.splice(index, 1, ...replacement)
      return index + replacement.length
    })
  }
}

/** A mdast text node whose `data.hName`/`hProperties` tell mdast-util-to-hast
 * (react-markdown's mdast -> hast step) to emit a real `<span
 * data-citation-value="...">` element instead of plain text -- no custom hast
 * node type or rehype handler needed, just the standard hName/hProperties
 * escape hatch every remark plugin uses for this. */
function citationNode(value: string): Text {
  return {
    type: 'text',
    value,
    data: { hName: 'span', hProperties: { 'data-citation-value': value } },
  } as Text
}

function CitationPill({ value }: { value: string }) {
  const Icon = /^https?:\/\//.test(value) ? LinkIcon : FileText
  return (
    <span
      title={value}
      className="mx-0.5 inline-flex max-w-[240px] items-center gap-1 rounded-sm bg-input px-1.5 py-0.5 align-middle font-mono text-[0.8em] text-on-surface-mid"
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{value}</span>
    </span>
  )
}

/** Manual Tailwind arbitrary-child-selectors instead of @tailwindcss/typography
 * -- one small, known set of markdown elements to style, not worth a whole
 * plugin for. Links reuse the same neutral mid/hover-high pair Sidebar's own
 * nav links use (no new colors). */
const MARKDOWN_CLASSNAME = clsx(
  // no whitespace-pre-wrap here (unlike the plain user-message bubble) --
  // markdown paragraphs already handle their own line flow, and forcing
  // pre-wrap would turn every soft line break in the source into a literal
  // hard break instead of the space CommonMark renders it as.
  'break-words font-body text-sm text-on-surface',
  '[&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_h1]:my-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_strong]:font-semibold',
  '[&_a]:text-on-surface-mid [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors [&_a]:duration-150 hover:[&_a]:text-on-surface',
  '[&_code]:rounded-sm [&_code]:bg-input [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-input [&_pre]:p-[var(--space-sm)]',
  '[&_pre_code]:whitespace-pre [&_pre_code]:bg-transparent [&_pre_code]:p-0',
)

/** `streaming` marks the block currently receiving deltas -- shows a blinking
 * cursor right after the text, gone the instant the block finishes (it's
 * removed from the DOM the moment `streaming` turns false, since the caller
 * stops rendering this component for that block at all). */
function MarkdownText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={MARKDOWN_CLASSNAME}>
      <ReactMarkdown
        remarkPlugins={[remarkCitations]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          span: ({ node: _node, ...props }) => {
            const citationValue = (props as Record<string, unknown>)['data-citation-value']
            if (typeof citationValue === 'string') return <CitationPill value={citationValue} />
            return <span {...props} />
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && (
        <span
          data-testid="stream-cursor"
          aria-hidden="true"
          className="inline-block h-4 w-[0.5ch] animate-pulse bg-on-surface align-text-bottom"
        />
      )}
    </div>
  )
}

export interface StreamBlock {
  key: string
  provider: Provider
  model: string
  text: string
}

interface MessageStreamProps {
  messages: ChatMessage[]
  streamBlocks: StreamBlock[]
  /** Deep-research step trace for the turn currently streaming -- a sibling
   * to streamBlocks rather than per-block, since one round of research feeds
   * every target's context, not just one (see chat/router.py's event_stream).
   * Optional so existing callers/tests that predate deep research don't need
   * updating just to pass an empty array. */
  researchSteps?: ResearchStepData[]
  /** Live trace of agentic tool calls (web_search / search_docs /
   * deep_research) the model made this turn -- a sibling to researchSteps,
   * same optional-for-old-callers reasoning. */
  toolCalls?: ToolCallData[]
  isEmpty: boolean
  onStartFirst: () => void
}

type Item = { type: 'user'; message: ChatMessage } | { type: 'assistant'; messages: ChatMessage[] }

/** Groups consecutive assistant messages that share a request_group_id — one
 * user turn with 2+ targets persists as several assistant rows, rendered
 * together as one labeled multi-block turn rather than separate messages. */
function groupMessages(messages: ChatMessage[]): Item[] {
  const items: Item[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m.role === 'user') {
      items.push({ type: 'user', message: m })
      i++
      continue
    }
    const group = [m]
    let j = i + 1
    while (
      j < messages.length &&
      messages[j].role === 'assistant' &&
      m.request_group_id != null &&
      messages[j].request_group_id === m.request_group_id
    ) {
      group.push(messages[j])
      j++
    }
    items.push({ type: 'assistant', messages: group })
    i = j
  }
  return items
}

function providerLabel(provider: Provider | null): string {
  return provider ? PROVIDER_LABELS[provider] : 'assistant'
}

const TOOL_CALL_VERBS: Record<string, string> = {
  web_search: 'Searching the web',
  search_docs: 'Searching your documents',
  deep_research: 'Researching',
}

/** `arguments`' shape is opaque JSON from the backend's tool-call loop -- read
 * `query` defensively (may be missing, or not a string) rather than assuming
 * the exact contract every tool lands on. */
function toolCallLabel(call: ToolCallData): string {
  const verb = TOOL_CALL_VERBS[call.name] ?? call.name
  const query = call.arguments?.query
  return typeof query === 'string' && query.length > 0 ? `${verb}: "${query}"` : verb
}

export function MessageStream({
  messages,
  streamBlocks,
  researchSteps = [],
  toolCalls = [],
  isEmpty,
  onStartFirst,
}: MessageStreamProps) {
  const items = groupMessages(messages)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Live text growing in a streamBlock doesn't change `messages` or block
  // count, so the effect also needs a dependency that changes on every delta
  // -- otherwise the view stays scrolled to where it was when the block
  // first appeared, and the floating dock ends up covering new text as it
  // streams in (found live: a real answer was fully received but hidden
  // behind the composer until the user scrolled manually).
  const streamLengths = streamBlocks.map((b) => b.text.length).join(',')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamLengths, researchSteps.length, toolCalls.length])

  return (
    <div className="h-full flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end gap-[var(--space-lg)] px-[var(--space-lg)] pb-56 pt-[var(--space-xl)]">
        {isEmpty && (
          <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-sm)] text-center">
            <p className="font-display text-lg font-medium text-on-surface">Start your first conversation</p>
            <p className="font-body text-sm text-on-surface-mid">Pick a target below and ask anything.</p>
            <button
              type="button"
              onClick={onStartFirst}
              className="mt-[var(--space-sm)] rounded-sm border border-rail-border px-4 py-2 font-display text-sm font-medium text-on-surface-mid transition-colors duration-150 hover:bg-surface hover:text-on-surface"
            >
              New conversation
            </button>
          </div>
        )}

        {items.map((item) =>
          item.type === 'user' ? (
            <div key={item.message.id} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-lg bg-surface px-[var(--space-md)] py-[var(--space-sm)] font-body text-sm text-on-surface">
                {item.message.content}
              </div>
            </div>
          ) : (
            <div
              key={item.messages[0].id}
              className={clsx('grid gap-[var(--space-lg)]', item.messages.length > 1 && 'md:grid-cols-2')}
            >
              {item.messages.map((m) => (
                <div key={m.id} className="flex flex-col gap-1.5">
                  <p className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid">
                    {providerLabel(m.provider)}
                    {m.model ? ` · ${m.model}` : ''}
                  </p>
                  <MarkdownText text={m.content} />
                </div>
              ))}
            </div>
          ),
        )}

        {researchSteps.length > 0 && (
          <div
            data-testid="research-trace"
            className="flex flex-col gap-1 rounded-lg border border-rail-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] font-body text-xs text-on-surface-mid"
          >
            {researchSteps.map((step) => (
              <p key={step.round} className="flex items-start gap-1.5">
                <Search className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>
                  Round {step.round} — searching: "{step.query}" — {step.sources_found.length} sources found
                </span>
              </p>
            ))}
          </div>
        )}

        {toolCalls.length > 0 && (
          <div
            data-testid="tool-call-trace"
            className="flex flex-col gap-1 rounded-lg border border-rail-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] font-body text-xs text-on-surface-mid"
          >
            {toolCalls.map((call, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <Search className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>{toolCallLabel(call)}</span>
              </p>
            ))}
          </div>
        )}

        {streamBlocks.length > 0 && (
          <div className={clsx('grid gap-[var(--space-lg)]', streamBlocks.length > 1 && 'md:grid-cols-2')}>
            {streamBlocks.map((b) => (
              <div key={b.key} data-testid={`stream-block-${b.key}`} className="flex flex-col gap-1.5">
                <p className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-primary">
                  {PROVIDER_LABELS[b.provider]} · {b.model}
                </p>
                <MarkdownText text={b.text || '…'} streaming />
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
