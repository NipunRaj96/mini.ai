import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../lib/api'
import { uploadDocument } from '../../lib/docs'
import { Sidebar } from './Sidebar'

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    errors: { field?: string; message: string }[]
    constructor(status: number, errors: { field?: string; message: string }[] = [{ message: 'error' }]) {
      super(errors[0]?.message ?? `Request failed (${status})`)
      this.status = status
      this.errors = errors
    }
  },
}))

// uploadDocument bypasses apiFetch (multipart, needs its own fetch call per
// docs.ts's comment) -- mock only that export, keep listDocuments/deleteDocument
// as the real implementations so they still go through the apiFetch mock above.
vi.mock('../../lib/docs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/docs')>()
  return { ...actual, uploadDocument: vi.fn() }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockApiFetch = vi.mocked(apiFetch)
const mockUploadDocument = vi.mocked(uploadDocument)

const conversations = [
  { id: 'c1', title: 'Trip planning', updated_at: new Date().toISOString() },
  { id: 'c2', title: null, updated_at: new Date().toISOString() },
]

const user = { id: 'u1', email: 'a@b.com', created_at: '2026-01-01T00:00:00Z' }

beforeEach(() => {
  mockNavigate.mockReset()
  mockApiFetch.mockReset()
  mockApiFetch.mockResolvedValue([])
  mockUploadDocument.mockReset()
})

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const onSelect = vi.fn()
  const onNew = vi.fn()
  const onDelete = vi.fn()
  const onLogout = vi.fn()
  const onSelectedDocsChange = vi.fn()
  const onToggleCollapse = vi.fn()
  render(
    <MemoryRouter>
      <Sidebar
        conversations={conversations}
        activeId="c1"
        user={user}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={onDelete}
        onLogout={onLogout}
        selectedDocIds={[]}
        onSelectedDocsChange={onSelectedDocsChange}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
        {...overrides}
      />
    </MemoryRouter>,
  )
  return { onSelect, onNew, onDelete, onLogout, onSelectedDocsChange, onToggleCollapse }
}

describe('Sidebar', () => {
  it('does not crash on a conversation with a missing/invalid updated_at (live bug: create-conversation response has no updated_at)', () => {
    expect(() =>
      renderSidebar({
        conversations: [{ id: 'c3', title: 'Just created', updated_at: undefined as unknown as string }],
      }),
    ).not.toThrow()
    expect(screen.getByText('Just created')).toBeInTheDocument()
  })

  it('renders each conversation, using "Untitled" for a null title', () => {
    renderSidebar()
    expect(screen.getByText('Trip planning')).toBeInTheDocument()
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('shows an empty state when there are no conversations', () => {
    renderSidebar({ conversations: [] })
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument()
  })

  it('calls onSelect with the conversation id when clicked', async () => {
    const { onSelect } = renderSidebar()
    await userEvent.click(screen.getByText('Trip planning'))
    expect(onSelect).toHaveBeenCalledWith('c1')
  })

  it('calls onNew when "New conversation" is clicked', async () => {
    const { onNew } = renderSidebar()
    await userEvent.click(screen.getByText('+ New conversation'))
    expect(onNew).toHaveBeenCalled()
  })

  it('calls onDelete with the conversation id after confirmation, without triggering onSelect', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onDelete, onSelect } = renderSidebar()
    await userEvent.click(screen.getByLabelText('Delete Trip planning'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledWith('c1')
    expect(onSelect).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not call onDelete when the confirmation is dismissed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onDelete } = renderSidebar()
    await userEvent.click(screen.getByLabelText('Delete Trip planning'))
    expect(onDelete).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('opens the profile menu and calls onLogout when Log out is clicked', async () => {
    const { onLogout } = renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(await screen.findByText('Log out'))
    expect(onLogout).toHaveBeenCalled()
  })

  it('navigates to /settings when Settings is clicked in the profile menu', async () => {
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(await screen.findByText('Settings'))
    expect(mockNavigate).toHaveBeenCalledWith('/settings')
  })

  it('shows the user email as the profile trigger and inside the menu', async () => {
    renderSidebar()
    expect(screen.getByText('a@b.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await screen.findAllByText('a@b.com')).toHaveLength(2)
  })

  it('does not render the profile menu when there is no user', () => {
    renderSidebar({ user: null })
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('shows a deployed-agent count on the Agent Console card once listAgents resolves', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 'a1', is_deployed: true },
      { id: 'a2', is_deployed: false },
      { id: 'a3', is_deployed: true },
    ])
    renderSidebar()
    expect(await screen.findByText('2 deployed')).toBeInTheDocument()
    expect(screen.getByText('Agent Console')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /agent console/i })).toHaveAttribute('href', '/agents')
  })

  it('shows a sensible empty state when no agents are deployed', async () => {
    mockApiFetch.mockResolvedValueOnce([])
    renderSidebar()
    expect(await screen.findByText('No agents deployed yet')).toBeInTheDocument()
  })

  it('does not crash and just omits the count when listAgents fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network error'))
    renderSidebar()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(screen.queryByText(/deployed/i)).not.toBeInTheDocument()
    expect(screen.getByText('Agent Console')).toBeInTheDocument()
  })
})

describe('Sidebar collapsed rail', () => {
  it('renders icon-only controls with aria-labels, and omits Docs/Chat History content', async () => {
    mockDocsAndAgentsForCollapsed()
    renderSidebar({ collapsed: true })

    // Wait for the agent count fetch so we know data-fetching still happens
    // while collapsed, even though nothing renders it.
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/agents'))

    expect(screen.getByLabelText('Open sidebar')).toBeInTheDocument()
    expect(screen.getByLabelText('New conversation')).toBeInTheDocument()
    expect(screen.getByLabelText('Agent Console')).toBeInTheDocument()
    expect(screen.getByLabelText('Account menu')).toBeInTheDocument()

    expect(screen.queryByText('Docs')).not.toBeInTheDocument()
    expect(screen.queryByText('Chat History')).not.toBeInTheDocument()
    expect(screen.queryByText('Trip planning')).not.toBeInTheDocument()
    expect(screen.queryByText('2 deployed')).not.toBeInTheDocument()
  })

  it('calls onToggleCollapse when the rail toggle is clicked', async () => {
    mockDocsAndAgentsForCollapsed()
    const { onToggleCollapse } = renderSidebar({ collapsed: true })

    await userEvent.click(screen.getByLabelText('Open sidebar'))
    expect(onToggleCollapse).toHaveBeenCalled()
  })

  it('calls onNew from the collapsed rail', async () => {
    mockDocsAndAgentsForCollapsed()
    const { onNew } = renderSidebar({ collapsed: true })

    await userEvent.click(screen.getByLabelText('New conversation'))
    expect(onNew).toHaveBeenCalled()
  })
})

function mockDocsAndAgentsForCollapsed() {
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/v1/docs') return []
    if (path === '/api/v1/agents') return [{ id: 'a1', is_deployed: true }]
    throw new Error(`unexpected call: ${path}`)
  })
}

describe('Sidebar Docs checklist', () => {
  const documents = [
    { id: 'd1', filename: 'policy.pdf', content_type: 'text/plain', status: 'ready', error_message: null, created_at: 't' },
    { id: 'd2', filename: 'handbook.pdf', content_type: 'text/plain', status: 'ready', error_message: null, created_at: 't' },
    { id: 'd3', filename: 'still-processing.pdf', content_type: 'text/plain', status: 'processing', error_message: null, created_at: 't' },
  ]

  function mockDocsAndAgents() {
    mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/docs') return documents
      if (path === '/api/v1/agents') return []
      if (path.startsWith('/api/v1/docs/') && init?.method === 'DELETE') return undefined
      throw new Error(`unexpected call: ${path}`)
    })
  }

  it('renders only READY documents, by filename', async () => {
    mockDocsAndAgents()
    renderSidebar()
    expect(await screen.findByText('policy.pdf')).toBeInTheDocument()
    expect(screen.getByText('handbook.pdf')).toBeInTheDocument()
    expect(screen.queryByText('still-processing.pdf')).not.toBeInTheDocument()
  })

  it('checking a document calls onSelectedDocsChange with it added', async () => {
    mockDocsAndAgents()
    const user = userEvent.setup()
    const { onSelectedDocsChange } = renderSidebar()

    await user.click(await screen.findByLabelText('Use policy.pdf for grounding'))
    expect(onSelectedDocsChange).toHaveBeenCalledWith(['d1'])
  })

  it('unchecking an already-selected document calls onSelectedDocsChange with it removed', async () => {
    mockDocsAndAgents()
    const user = userEvent.setup()
    const { onSelectedDocsChange } = renderSidebar({ selectedDocIds: ['d1', 'd2'] })

    await user.click(await screen.findByLabelText('Use policy.pdf for grounding'))
    expect(onSelectedDocsChange).toHaveBeenCalledWith(['d2'])
  })

  it('still renders the DOCS section (with a working + button) when there are no documents', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/docs') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    renderSidebar()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/docs'))
    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument()
    const input = screen.getByLabelText('Document file') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    await userEvent.click(screen.getByLabelText('Upload document'))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('selecting a file calls uploadDocument and refreshes the list', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/docs') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockUploadDocument.mockResolvedValue({
      id: 'd9',
      filename: 'new.pdf',
      content_type: 'application/pdf',
      status: 'ready',
      error_message: null,
      created_at: 't',
    })
    const userEv = userEvent.setup()
    renderSidebar()
    await screen.findByText(/no documents yet/i)

    const file = new File(['hello'], 'new.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText('Document file') as HTMLInputElement
    await userEv.upload(input, file)

    expect(mockUploadDocument).toHaveBeenCalledWith(file)
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.filter(([p]) => p === '/api/v1/docs').length).toBeGreaterThanOrEqual(2),
    )
  })

  it('selecting multiple files uploads each one and refreshes the doc list only once', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/docs') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockUploadDocument.mockImplementation(async (file: File) => ({
      id: file.name,
      filename: file.name,
      content_type: 'application/pdf',
      status: 'ready',
      error_message: null,
      created_at: 't',
    }))
    const userEv = userEvent.setup()
    renderSidebar()
    await screen.findByText(/no documents yet/i)

    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]
    const input = screen.getByLabelText('Document file') as HTMLInputElement
    expect(input).toHaveAttribute('multiple')
    await userEv.upload(input, files)

    await waitFor(() => expect(mockUploadDocument).toHaveBeenCalledTimes(3))
    for (const file of files) {
      expect(mockUploadDocument).toHaveBeenCalledWith(file)
    }
    // Exactly one refresh (initial mount fetch + one post-upload fetch), not one per file.
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.filter(([p]) => p === '/api/v1/docs').length).toBe(2),
    )
  })

  it('shows an inline error when uploadDocument throws', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/docs') return []
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockUploadDocument.mockRejectedValue(new Error('nope'))
    const userEv = userEvent.setup()
    renderSidebar()
    await screen.findByText(/no documents yet/i)

    const file = new File(['hello'], 'bad.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText('Document file') as HTMLInputElement
    await userEv.upload(input, file)

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to upload: bad\.pdf/i)
  })

  it('a partial-failure batch shows a combined error but keeps the successful uploads', async () => {
    let docsCallCount = 0
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/docs') {
        docsCallCount += 1
        // First fetch (mount) sees nothing yet; the post-batch refresh sees
        // the one file that actually succeeded.
        if (docsCallCount === 1) return []
        return [
          {
            id: 'd1',
            filename: 'b.pdf',
            content_type: 'application/pdf',
            status: 'ready',
            error_message: null,
            created_at: 't',
          },
        ]
      }
      if (path === '/api/v1/agents') return []
      throw new Error(`unexpected call: ${path}`)
    })
    mockUploadDocument.mockImplementation(async (file: File) => {
      if (file.name !== 'b.pdf') throw new Error('nope')
      return {
        id: 'd1',
        filename: 'b.pdf',
        content_type: 'application/pdf',
        status: 'ready',
        error_message: null,
        created_at: 't',
      }
    })
    const userEv = userEvent.setup()
    renderSidebar()
    await screen.findByText(/no documents yet/i)

    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]
    const input = screen.getByLabelText('Document file') as HTMLInputElement
    await userEv.upload(input, files)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to upload: a.pdf, c.pdf')
    expect(await screen.findByText('b.pdf')).toBeInTheDocument()
  })

  it('Select All checks every ready document; clicking it again clears them all', async () => {
    mockDocsAndAgents()
    const userEv = userEvent.setup()
    const { onSelectedDocsChange } = renderSidebar()

    await userEv.click(await screen.findByLabelText('Select All (2)'))
    expect(onSelectedDocsChange).toHaveBeenCalledWith(['d1', 'd2'])
  })

  it('unchecking Select All when every ready doc is already selected clears selectedDocIds', async () => {
    mockDocsAndAgents()
    const userEv = userEvent.setup()
    const { onSelectedDocsChange } = renderSidebar({ selectedDocIds: ['d1', 'd2'] })

    await userEv.click(await screen.findByLabelText('Select All (2)'))
    expect(onSelectedDocsChange).toHaveBeenCalledWith([])
  })

  it('deleting a document (confirmed, success) removes it and clears it from selectedDocIds', async () => {
    mockDocsAndAgents()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const userEv = userEvent.setup()
    const { onSelectedDocsChange } = renderSidebar({ selectedDocIds: ['d1'] })

    await userEv.click(await screen.findByLabelText('Delete policy.pdf'))

    await waitFor(() => expect(screen.queryByText('policy.pdf')).not.toBeInTheDocument())
    expect(onSelectedDocsChange).toHaveBeenCalledWith([])
    confirmSpy.mockRestore()
  })

  it('does not delete when the confirmation is dismissed', async () => {
    mockDocsAndAgents()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const userEv = userEvent.setup()
    renderSidebar()

    await userEv.click(await screen.findByLabelText('Delete policy.pdf'))
    expect(screen.getByText('policy.pdf')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('shows an error and keeps the document listed when delete fails', async () => {
    mockDocsAndAgents()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const userEv = userEvent.setup()
    renderSidebar()
    await screen.findByText('policy.pdf')

    mockApiFetch.mockRejectedValueOnce(new Error('boom'))
    await userEv.click(screen.getByLabelText('Delete policy.pdf'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to delete document/i)
    expect(screen.getByText('policy.pdf')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
