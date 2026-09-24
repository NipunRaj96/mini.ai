import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../lib/chat'
import { MessageStream } from './MessageStream'

describe('MessageStream auto-scroll', () => {
  // Live bug: a fully-streamed answer was hidden behind the floating composer
  // dock because the scroll container never followed new content -- the user
  // had to scroll down manually to see their own answer.
  it('scrolls to bottom when a new message arrives', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { rerender } = render(
      <MessageStream messages={[]} streamBlocks={[]} isEmpty onStartFirst={() => {}} />,
    )
    scrollSpy.mockClear()

    rerender(
      <MessageStream
        messages={[
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            provider: null,
            model: null,
            request_group_id: null,
            created_at: '2026-09-20T00:00:00Z',
          },
        ]}
        streamBlocks={[]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    expect(scrollSpy).toHaveBeenCalled()
    scrollSpy.mockRestore()
  })

  it('scrolls to bottom as a stream block grows text (not just on message count changes)', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const block = { key: 'groq:qwen', provider: 'groq' as const, model: 'qwen', text: 'Hel' }
    const { rerender } = render(
      <MessageStream messages={[]} streamBlocks={[block]} isEmpty={false} onStartFirst={() => {}} />,
    )
    scrollSpy.mockClear()

    rerender(
      <MessageStream
        messages={[]}
        streamBlocks={[{ ...block, text: 'Hello there' }]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    expect(scrollSpy).toHaveBeenCalled()
    scrollSpy.mockRestore()
  })
})

describe('MessageStream request_group_id grouping', () => {
  // Phase 8b: synthesize=true adds a 3rd (judge) assistant message to a turn
  // that already had 2 tagged-agent participants -- groupMessages' while loop
  // is not hardcoded to 2, so this should render as one 3-column turn with no
  // MessageStream code changes needed. This test proves that, rather than
  // assuming it.
  it('renders a 3-message group (2 participants + 1 judge) sharing a request_group_id as 3 blocks', () => {
    const groupId = 'g1'
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'compare these',
        provider: null,
        model: null,
        request_group_id: null,
        created_at: '2026-09-20T00:00:00Z',
      },
      {
        id: 'm1',
        role: 'assistant',
        content: 'Answer from agent A',
        provider: 'openai',
        model: 'gpt-5',
        request_group_id: groupId,
        created_at: '2026-09-20T00:00:01Z',
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Answer from agent B',
        provider: 'anthropic',
        model: 'claude-opus',
        request_group_id: groupId,
        created_at: '2026-09-20T00:00:02Z',
      },
      {
        id: 'm3',
        role: 'assistant',
        content: 'Judge synthesis of both answers',
        provider: 'openai',
        model: 'gpt-5',
        request_group_id: groupId,
        created_at: '2026-09-20T00:00:03Z',
      },
    ]

    render(<MessageStream messages={messages} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />)

    expect(screen.getByText('Answer from agent A')).toBeInTheDocument()
    expect(screen.getByText('Answer from agent B')).toBeInTheDocument()
    expect(screen.getByText('Judge synthesis of both answers')).toBeInTheDocument()
  })
})

describe('MessageStream deep-research step trace', () => {
  it('renders nothing when there are no research steps', () => {
    render(<MessageStream messages={[]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />)
    expect(screen.queryByTestId('research-trace')).not.toBeInTheDocument()
  })

  it('renders one line per round, live above the streaming answer', () => {
    const block = { key: 'openai:gpt-5', provider: 'openai' as const, model: 'gpt-5', text: 'Partial answer' }
    render(
      <MessageStream
        messages={[]}
        streamBlocks={[block]}
        researchSteps={[
          { round: 1, query: 'first query', sources_found: ['https://a.com', 'https://b.com'] },
          { round: 2, query: 'second query', sources_found: ['https://c.com'] },
        ]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    const trace = screen.getByTestId('research-trace')
    expect(trace).toHaveTextContent('Round 1')
    expect(trace).toHaveTextContent('first query')
    expect(trace).toHaveTextContent('2 sources found')
    expect(trace).toHaveTextContent('Round 2')
    expect(trace).toHaveTextContent('second query')
    expect(trace).toHaveTextContent('1 sources found')
    // The trace stays visible alongside the in-progress answer, not hidden by it.
    expect(screen.getByText('Partial answer')).toBeInTheDocument()
  })
})

describe('MessageStream agentic tool-call trace', () => {
  it('renders nothing when there are no tool calls', () => {
    render(<MessageStream messages={[]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />)
    expect(screen.queryByTestId('tool-call-trace')).not.toBeInTheDocument()
  })

  it('renders a labeled line per tool name, live above the streaming answer', () => {
    const block = { key: 'openai:gpt-5', provider: 'openai' as const, model: 'gpt-5', text: 'Partial answer' }
    render(
      <MessageStream
        messages={[]}
        streamBlocks={[block]}
        toolCalls={[
          { name: 'web_search', arguments: { query: 'latest RBI repo rate' } },
          { name: 'search_docs', arguments: { query: 'policy renewal terms' } },
          { name: 'deep_research', arguments: { query: 'competitor pricing' } },
        ]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    const trace = screen.getByTestId('tool-call-trace')
    expect(trace).toHaveTextContent('Searching the web: "latest RBI repo rate"')
    expect(trace).toHaveTextContent('Searching your documents: "policy renewal terms"')
    expect(trace).toHaveTextContent('Researching: "competitor pricing"')
    // The trace stays visible alongside the in-progress answer, not hidden by it.
    expect(screen.getByText('Partial answer')).toBeInTheDocument()
  })

  it('shows a sensible fallback label when arguments.query is missing, empty, or the wrong type', () => {
    render(
      <MessageStream
        messages={[]}
        streamBlocks={[]}
        toolCalls={[
          { name: 'web_search', arguments: {} },
          { name: 'search_docs', arguments: { query: '' } },
          { name: 'deep_research', arguments: { query: 42 as unknown as string } },
          { name: 'some_future_tool', arguments: { query: 'x' } },
        ]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    const trace = screen.getByTestId('tool-call-trace')
    expect(trace).toHaveTextContent('Searching the web')
    expect(trace).toHaveTextContent('Searching your documents')
    expect(trace).toHaveTextContent('Researching')
    // Unknown tool name falls back to the raw name rather than crashing.
    expect(trace).toHaveTextContent('some_future_tool')
  })
})

describe('MessageStream markdown rendering', () => {
  function assistantMessage(content: string): ChatMessage {
    return {
      id: 'm1',
      role: 'assistant',
      content,
      provider: 'openai',
      model: 'gpt-5',
      request_group_id: null,
      created_at: '2026-09-20T00:00:00Z',
    }
  }

  it('renders assistant markdown (bold, list, code block) as real elements', () => {
    const content = '**bold text**\n\n- item one\n- item two\n\n```js\nconst x = 1;\n```'
    render(
      <MessageStream messages={[assistantMessage(content)]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />,
    )

    expect(screen.getByText('bold text').tagName).toBe('STRONG')
    expect(screen.getByText('item one').closest('ul')).not.toBeNull()
    expect(screen.getByText('item two').closest('ul')).not.toBeNull()
    expect(document.querySelector('pre code')?.textContent).toContain('const x = 1;')
  })

  it('does not interpret markdown syntax in a user message -- stays literal', () => {
    const userMessage: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '**not bold** and `not code`',
      provider: null,
      model: null,
      request_group_id: null,
      created_at: '2026-09-20T00:00:00Z',
    }
    render(<MessageStream messages={[userMessage]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />)

    expect(screen.getByText('**not bold** and `not code`')).toBeInTheDocument()
    expect(document.querySelector('strong')).toBeNull()
    expect(document.querySelector('code')).toBeNull()
  })

  it('shows a streaming cursor only on the live streaming block, not on persisted messages', () => {
    const block = { key: 'openai:gpt-5', provider: 'openai' as const, model: 'gpt-5', text: 'partial' }
    render(
      <MessageStream
        messages={[assistantMessage('finished answer')]}
        streamBlocks={[block]}
        isEmpty={false}
        onStartFirst={() => {}}
      />,
    )

    const cursors = screen.getAllByTestId('stream-cursor')
    expect(cursors).toHaveLength(1)
    // The cursor lives inside the live stream block, not the finished message.
    expect(screen.getByTestId('stream-block-openai:gpt-5').contains(cursors[0])).toBe(true)
  })

  it('does not crash and does not render garbage on incomplete/truncated markdown mid-stream', () => {
    const truncated = { key: 'openai:gpt-5', provider: 'openai' as const, model: 'gpt-5', text: 'Here is some code:\n\n```js\nconst x = ' }
    expect(() =>
      render(<MessageStream messages={[]} streamBlocks={[truncated]} isEmpty={false} onStartFirst={() => {}} />),
    ).not.toThrow()

    expect(screen.getByTestId('stream-block-openai:gpt-5')).toHaveTextContent('Here is some code:')
  })
})

describe('MessageStream source citation highlighting', () => {
  function assistantMessage(content: string): ChatMessage {
    return {
      id: 'm1',
      role: 'assistant',
      content,
      provider: 'openai',
      model: 'gpt-5',
      request_group_id: null,
      created_at: '2026-09-20T00:00:00Z',
    }
  }

  it('renders a document citation as a distinct pill, not plain bracket text', () => {
    const content = 'RBI requires quarterly filings [source: report.pdf, page 2].'
    render(
      <MessageStream messages={[assistantMessage(content)]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />,
    )

    expect(screen.queryByText(/\[source:/)).not.toBeInTheDocument()
    const pill = screen.getByTitle('report.pdf, page 2')
    expect(pill).toHaveTextContent('report.pdf, page 2')
  })

  it('renders a URL-based citation as a pill too', () => {
    const content = 'See the announcement [source: https://example.com/rbi-notice].'
    render(
      <MessageStream messages={[assistantMessage(content)]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />,
    )

    expect(screen.getByTitle('https://example.com/rbi-notice')).toBeInTheDocument()
  })

  it('does not throw when a citation is truncated mid-stream (no closing bracket yet)', () => {
    const truncated = {
      key: 'openai:gpt-5',
      provider: 'openai' as const,
      model: 'gpt-5',
      text: 'RBI requires quarterly filings [source: report.pdf',
    }
    expect(() =>
      render(<MessageStream messages={[]} streamBlocks={[truncated]} isEmpty={false} onStartFirst={() => {}} />),
    ).not.toThrow()

    expect(screen.getByTestId('stream-block-openai:gpt-5')).toHaveTextContent('[source: report.pdf')
  })

  it('still renders normal markdown (bold, list, code) unchanged alongside the plugin', () => {
    const content = '**bold text**\n\n- item one\n- item two\n\n```js\nconst x = 1;\n```'
    render(
      <MessageStream messages={[assistantMessage(content)]} streamBlocks={[]} isEmpty={false} onStartFirst={() => {}} />,
    )

    expect(screen.getByText('bold text').tagName).toBe('STRONG')
    expect(screen.getByText('item one').closest('ul')).not.toBeNull()
    expect(document.querySelector('pre code')?.textContent).toContain('const x = 1;')
  })
})
