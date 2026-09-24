import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import clsx from 'clsx'
import { Bot, PanelLeftClose, PanelLeftOpen, Plus, SquarePen } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Checkbox } from '../ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { listAgents } from '../../lib/agents'
import { ApiError } from '../../lib/api'
import { deleteDocument, listDocuments, uploadDocument, type Document } from '../../lib/docs'
import type { Conversation } from '../../lib/chat'
import type { User } from '../../lib/auth'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string | null
  user: User | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onLogout: () => void
  /** Ids of documents checked in the Docs section -- lifted to Home.tsx, which
   * derives use_docs grounding from whether this is non-empty (see Composer's
   * removed "Use Docs" toggle: checking a doc here IS turning grounding on). */
  selectedDocIds: string[]
  onSelectedDocsChange: (ids: string[]) => void
  /** When true, renders the icon-only rail instead of the full w-64 panel.
   * Sidebar owns both visual states and animates its own width -- Home.tsx
   * just holds the open/closed bit. */
  collapsed: boolean
  onToggleCollapse: () => void
}

const RELATIVE_UNITS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.345, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
]
const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function formatRelativeTime(iso: string): string {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  let value = Math.round((Date.now() - ms) / 1000)
  let unit: Intl.RelativeTimeFormatUnit = 'second'
  for (const [amount, nextUnit] of RELATIVE_UNITS) {
    unit = nextUnit
    if (Math.abs(value) < amount) break
    value = Math.round(value / amount)
  }
  return relativeTimeFormatter.format(-value, unit)
}

/** "Chocolate Bar" — fixed 300px conversation rail. */
export function Sidebar({
  conversations,
  activeId,
  user,
  onSelect,
  onNew,
  onDelete,
  onLogout,
  selectedDocIds,
  onSelectedDocsChange,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const navigate = useNavigate()
  // null = still loading, or the fetch failed -- the card just omits the
  // count in that case rather than showing a misleading "0" or spinning
  // forever. A resolved 0 is distinct and renders as "No agents deployed yet".
  const [deployedCount, setDeployedCount] = useState<number | null>(null)
  const [readyDocs, setReadyDocs] = useState<Document[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listAgents()
      .then((all) => setDeployedCount(all.filter((a) => a.is_deployed).length))
      .catch(() => setDeployedCount(null))
  }, [])

  function refreshDocs() {
    return listDocuments()
      .then((all) => setReadyDocs(all.filter((d) => d.status === 'ready')))
      .catch(() => setReadyDocs([]))
  }

  useEffect(() => {
    void refreshDocs()
  }, [])

  function toggleDoc(id: string, checked: boolean) {
    onSelectedDocsChange(checked ? [...selectedDocIds, id] : selectedDocIds.filter((d) => d !== id))
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file(s) again later
    if (files.length === 0) return
    setUploadError(null)
    setUploading(true)
    // Sequential, not Promise.all: safer against the backend's arq-queue-per-request
    // pattern, and keeps per-file error attribution simple. One bad file shouldn't
    // block the rest of the batch from uploading.
    const failed: string[] = []
    for (const file of files) {
      try {
        await uploadDocument(file)
      } catch {
        failed.push(file.name)
      }
    }
    if (failed.length > 0) {
      setUploadError(`Failed to upload: ${failed.join(', ')}`)
    }
    await refreshDocs()
    setUploading(false)
  }

  async function handleDeleteDoc(doc: Document) {
    if (!window.confirm(`Delete "${doc.filename}"? This can't be undone.`)) return
    try {
      await deleteDocument(doc.id)
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to delete document. Please try again.')
      return
    }
    setReadyDocs((prev) => prev.filter((d) => d.id !== doc.id))
    if (selectedDocIds.includes(doc.id)) {
      onSelectedDocsChange(selectedDocIds.filter((id) => id !== doc.id))
    }
  }

  function toggleSelectAll(checked: boolean) {
    onSelectedDocsChange(checked ? readyDocs.map((d) => d.id) : [])
  }

  const initial = user?.email?.[0]?.toUpperCase() ?? '?'

  // Single persistent <aside> for both states -- only its width class and
  // children change on toggle, so it's the same DOM node before and after,
  // which is what lets the browser actually interpolate transition-[width]
  // instead of snapping (two structurally different <aside> subtrees, as
  // this used to render via an early return, can never share an animation:
  // React unmounts one and mounts the other, so there's no continuous node
  // for the width transition to animate).
  // A per-content fade was considered but skipped: the collapsed/open inner
  // content still swaps via conditional rendering (mount/unmount), so a
  // CSS opacity transition on it can't actually play -- doing that properly
  // needs both trees mounted at once and cross-faded, which is real added
  // complexity for a cosmetic nice-to-have. The width transition alone on
  // the shared node already fixes the reported "stretching" glitch.
  return (
    <aside
      className={clsx(
        'flex h-full shrink-0 flex-col border-r border-rail-border bg-rail transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-14 items-center py-[var(--space-md)]' : 'w-64',
      )}
    >
      {collapsed ? (
        <>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-low transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onNew}
            aria-label="New conversation"
            title="New conversation"
            className="mt-[var(--space-md)] flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-mid transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface"
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
          </button>

          <Link
            to="/agents"
            aria-label="Agent Console"
            title="Agent Console"
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-mid transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface"
          >
            <Bot className="h-4 w-4" aria-hidden="true" />
          </Link>

          {user && (
            <div className="mt-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex h-8 w-8 items-center justify-center rounded-sm transition-colors duration-150 hover:bg-rail-elevated"
                  aria-label="Account menu"
                  title={user.email}
                >
                  <Avatar size="sm">
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuLabel className="truncate normal-case">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/settings')}>Settings</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onLogout}>Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-[var(--space-lg)] pb-[var(--space-md)] pt-[var(--space-lg)]">
            <span className="inline-flex items-center gap-1.5 font-display text-base tracking-[-0.02em] text-on-surface">
              mini.ai
              <span className="h-1.5 w-1.5 rounded-full bg-accent opacity-80" aria-hidden="true" />
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Close sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-sm text-on-surface-low transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="px-[var(--space-md)]">
            <button
              type="button"
              onClick={onNew}
              className="w-full rounded-sm px-3 py-2 text-left font-display text-sm font-medium text-on-surface-mid transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface"
            >
              + New conversation
            </button>
            <Link
              to="/agents"
              className="mt-1 flex items-center gap-2.5 rounded-sm px-3 py-2 transition-colors duration-150 hover:bg-rail-elevated"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-rail-elevated text-on-surface-mid">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-sm font-medium text-on-surface">Agent Console</span>
                {deployedCount !== null && (
                  <span className="block truncate font-body text-xs text-on-surface-low">
                    {deployedCount === 0 ? 'No agents deployed yet' : `${deployedCount} deployed`}
                  </span>
                )}
              </span>
            </Link>
          </div>

          <div className="mt-[var(--space-md)] px-[var(--space-md)]">
            <div className="flex items-center justify-between px-1 pb-1">
              <p className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-low">
                Docs
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="Upload document"
                className="flex h-5 w-5 items-center justify-center rounded-sm text-on-surface-low transition-colors duration-150 hover:bg-rail-elevated hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                aria-label="Document file"
                accept=".txt,.md,.pdf,.docx"
                disabled={uploading}
                onChange={(e) => void handleFileSelected(e)}
                className="hidden"
              />
            </div>

            {uploadError && (
              <p role="alert" className="px-1 pb-1 font-body text-xs text-error">
                {uploadError}
              </p>
            )}

            {readyDocs.length === 0 ? (
              <p className="px-1 py-1 font-body text-xs text-on-surface-low">No documents yet</p>
            ) : (
              <>
                <label className="flex items-center gap-2 rounded-sm px-1 py-1 transition-colors duration-150 hover:bg-rail-elevated">
                  <Checkbox
                    checked={readyDocs.every((d) => selectedDocIds.includes(d.id))}
                    onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    aria-label={`Select All (${readyDocs.length})`}
                  />
                  <span className="min-w-0 flex-1 truncate font-body text-xs text-on-surface-mid">
                    Select All ({readyDocs.length})
                  </span>
                </label>
                <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {readyDocs.map((doc) => (
                    <li key={doc.id} className="group relative">
                      <label className="flex items-center gap-2 rounded-sm py-1 pl-1 pr-6 transition-colors duration-150 hover:bg-rail-elevated">
                        <Checkbox
                          checked={selectedDocIds.includes(doc.id)}
                          onCheckedChange={(checked) => toggleDoc(doc.id, checked === true)}
                          aria-label={`Use ${doc.filename} for grounding`}
                        />
                        <span className="min-w-0 flex-1 truncate font-body text-xs text-on-surface-mid">
                          {doc.filename}
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label={`Delete ${doc.filename}`}
                        onClick={() => void handleDeleteDoc(doc)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 py-1 font-body text-on-surface-low opacity-0 transition-opacity duration-150 hover:text-error group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <nav
            aria-label="Conversations"
            className="mt-[var(--space-md)] flex-1 overflow-y-auto px-[var(--space-sm)]"
          >
            <p className="px-2 pb-1 font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-low">
              Chat History
            </p>
            {conversations.length === 0 ? (
              <p className="px-2 py-[var(--space-sm)] font-body text-xs text-on-surface-low">No conversations yet</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {conversations.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      aria-current={c.id === activeId || undefined}
                      className={clsx(
                        'w-full rounded-sm px-3 py-2 pr-8 text-left transition-colors duration-150',
                        c.id === activeId ? 'bg-rail-hover' : 'hover:bg-rail-elevated',
                      )}
                    >
                      <span className="block truncate font-body text-sm text-on-surface">
                        {c.title ?? 'Untitled'}
                      </span>
                      <span className="block font-body text-xs text-on-surface-low">
                        {formatRelativeTime(c.updated_at)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${c.title ?? 'Untitled'}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`Delete "${c.title ?? 'Untitled'}"? This can't be undone.`)) {
                          onDelete(c.id)
                        }
                      }}
                      className="absolute right-1.5 top-1.5 rounded-sm px-1.5 py-1 font-body text-on-surface-low opacity-0 transition-opacity duration-150 hover:text-error group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          {user && (
            <div className="border-t border-rail-border px-[var(--space-md)] py-[var(--space-md)]">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-left transition-colors duration-150 hover:bg-rail-elevated"
                  aria-label="Account menu"
                >
                  <Avatar size="sm">
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate font-body text-xs text-on-surface-mid">{user.email}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  <DropdownMenuLabel className="truncate normal-case">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/settings')}>Settings</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onLogout}>Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
