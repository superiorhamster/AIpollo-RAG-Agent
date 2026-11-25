'use client'

import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { DesignIcon, type IconName } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import type { Workspace } from '../../lib/api'
import { workspaceLocation, type WorkspaceView } from '../../lib/workspace-location'

export type SidebarDocument = {
  document_id: string
  name: string
}

export type SourceJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export const WORKSPACE_VIEWS: {
  id: WorkspaceView
  label: string
  vietnamese: string
  icon: IconName
  activeIcon?: IconName
}[] = [
  { id: 'chats', label: 'Chats', vietnamese: 'Trò chuyện', icon: 'chats', activeIcon: 'chats-active' },
  { id: 'library', label: 'Documents', vietnamese: 'Tài liệu', icon: 'library', activeIcon: 'library-active' },
  { id: 'notes', label: 'Notes', vietnamese: 'Ghi chú', icon: 'notes' },
  { id: 'plans', label: 'Plans', vietnamese: 'Kế hoạch', icon: 'plan' },
  { id: 'artifacts', label: 'Artifacts', vietnamese: 'Sản phẩm', icon: 'artifacts', activeIcon: 'artifacts-active' },
  { id: 'references', label: 'References', vietnamese: 'Tài liệu tham khảo', icon: 'references' },
  { id: 'history', label: 'History', vietnamese: 'Lịch sử', icon: 'history' },
]

const STATUS_BADGE_CLASS: Record<SourceJobStatus, string> = {
  succeeded: 'success',
  running: 'warning',
  queued: 'info',
  failed: 'danger',
  cancelled: 'neutral',
}

const STATUS_LABELS: Record<SourceJobStatus, { en: string; vi: string }> = {
  succeeded: { en: 'Ready', vi: 'Sẵn sàng' },
  running: { en: 'Processing', vi: 'Đang xử lý' },
  queued: { en: 'Queued', vi: 'Đang chờ' },
  failed: { en: 'Failed', vi: 'Lỗi' },
  cancelled: { en: 'Cancelled', vi: 'Đã hủy' },
}

export function WorkspaceSidebar({
  sidebarRef,
  workspace,
  workspaces,
  mayWrite,
  view,
  documents,
  selectedId,
  selectedSources,
  sourcesLocked,
  sourceState,
  onUpload,
  onNavigate,
  onToggleSource,
  onOpenDocument,
}: {
  sidebarRef: RefObject<HTMLElement | null>
  workspace: Workspace
  workspaces: Workspace[]
  mayWrite: boolean
  view: WorkspaceView
  documents: SidebarDocument[]
  selectedId?: string
  selectedSources: string[]
  sourcesLocked: boolean
  sourceState: (doc: SidebarDocument) => SourceJobStatus
  onUpload: () => void
  onNavigate: (next: WorkspaceView) => void
  onToggleSource: (documentId: string, checked: boolean) => void
  onOpenDocument: (documentId: string) => void
}) {
  const { text } = useWorkspaceLanguage()
  // Current workspace starts expanded; other workspaces start collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [workspace.workspace_id]: true,
  }))

  useEffect(() => {
    setExpanded({ [workspace.workspace_id]: true })
  }, [workspace.workspace_id])

  function setBranchExpanded(id: string, next: boolean) {
    setExpanded(current => ({ ...current, [id]: next }))
  }

  function handleBranchKey(id: string, isExpanded: boolean, event: KeyboardEvent) {
    if (event.key === 'ArrowRight' && !isExpanded) {
      event.preventDefault()
      setBranchExpanded(id, true)
    } else if (event.key === 'ArrowLeft' && isExpanded) {
      event.preventDefault()
      setBranchExpanded(id, false)
    }
  }

  const branchWorkspaces = workspaces.some(item => item.workspace_id === workspace.workspace_id)
    ? workspaces
    : [workspace, ...workspaces]

  return (
    <aside ref={sidebarRef} className="workspace-sidebar" aria-label="Workspace navigation">
      {mayWrite && (
        <button className="workspace-upload" type="button" onClick={onUpload} title={text('Upload source', 'Tải tài liệu lên')}>
          <DesignIcon name="upload" />
          <span className="sidebar-ellipsis">{text('Upload source', 'Tải tài liệu lên')}</span>
        </button>
      )}
      <Link href="/workspaces" className="workspace-nav-caption workspace-back-link" aria-label="Back to workspaces">
        <span className="sidebar-ellipsis">{text('Workspaces', 'Không gian làm việc')}</span>
      </Link>

      <div className="workspace-tree" role="region" aria-label={text('Workspaces', 'Không gian làm việc')}>
        {branchWorkspaces.map(item => {
          const isCurrent = item.workspace_id === workspace.workspace_id
          const isExpanded = expanded[item.workspace_id] ?? isCurrent
          const branchId = `workspace-branch-${item.workspace_id}`
          return (
            <div className="workspace-tree-node" key={item.workspace_id} data-current={isCurrent ? 'true' : undefined}>
              <div className="workspace-tree-header">
                <button
                  type="button"
                  className="workspace-tree-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={branchId}
                  aria-label={text(
                    `${isExpanded ? 'Collapse' : 'Expand'} ${item.name}`,
                    `${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${item.name}`,
                  )}
                  onClick={() => setBranchExpanded(item.workspace_id, !isExpanded)}
                  onKeyDown={event => handleBranchKey(item.workspace_id, isExpanded, event)}
                >
                  {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                </button>
                <Link
                  href={workspaceLocation(item.workspace_id, undefined, 1)}
                  className="workspace-tree-link"
                  aria-current={isCurrent ? 'page' : undefined}
                  title={item.name}
                  onKeyDown={event => handleBranchKey(item.workspace_id, isExpanded, event)}
                >
                  <DesignIcon name={isCurrent ? 'folder-active' : 'folder'} />
                  <span className="workspace-tree-name">{item.name}</span>
                </Link>
              </div>

              {isExpanded && (
                <div id={branchId} className="workspace-tree-children">
                  <nav className="workspace-nav" aria-label={isCurrent ? 'Workspace sections' : item.name}>
                    {WORKSPACE_VIEWS.map(section => {
                      const label = text(section.label, section.vietnamese)
                      if (isCurrent) {
                        const active = view === section.id
                        return (
                          <button
                            className="workspace-nav-item"
                            key={section.id}
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            title={label}
                            onClick={() => onNavigate(section.id)}
                          >
                            <DesignIcon name={active ? section.activeIcon ?? section.icon : section.icon} />
                            <span className="sidebar-ellipsis">{label}</span>
                          </button>
                        )
                      }
                      return (
                        <Link
                          className="workspace-nav-item workspace-nav-link"
                          key={section.id}
                          href={workspaceLocation(item.workspace_id, undefined, 1, section.id)}
                          title={label}
                        >
                          <DesignIcon name={section.icon} />
                          <span className="sidebar-ellipsis">{label}</span>
                        </Link>
                      )
                    })}
                  </nav>

                  {isCurrent && (
                    <fieldset className="workspace-sources" disabled={sourcesLocked}>
                      <legend className="workspace-nav-caption sidebar-ellipsis" title={text('Sources', 'Nguồn')}>
                        {text('Sources', 'Nguồn')} · {text(`${selectedSources.length} of ${documents.length} active`, `đã chọn ${selectedSources.length}/${documents.length}`)}
                      </legend>
                      {documents.map(doc => {
                        const checked = selectedSources.includes(doc.document_id)
                        const state = sourceState(doc)
                        const statusText = text(STATUS_LABELS[state].en, STATUS_LABELS[state].vi)
                        return (
                          <div
                            className="workspace-source"
                            key={doc.document_id}
                            data-checked={checked}
                            data-active={selectedId === doc.document_id ? 'true' : undefined}
                          >
                            <input
                              type="checkbox"
                              aria-label={doc.name}
                              checked={checked}
                              disabled={state !== 'succeeded'}
                              onChange={event => onToggleSource(doc.document_id, event.currentTarget.checked)}
                            />
                            <button
                              type="button"
                              className="workspace-source-open"
                              title={doc.name}
                              aria-current={selectedId === doc.document_id ? 'true' : undefined}
                              onClick={() => onOpenDocument(doc.document_id)}
                            >
                              <DesignIcon name="file" />
                              <span className="source-name">{doc.name}</span>
                            </button>
                            {state !== 'succeeded' && (
                              <span className={'badge badge-' + STATUS_BADGE_CLASS[state]} title={statusText}>
                                {statusText}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </fieldset>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
