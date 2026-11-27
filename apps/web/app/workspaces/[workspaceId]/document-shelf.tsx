'use client'

import Link from 'next/link'
import { mapConcurrent } from '../../lib/polling'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Trash2 } from 'lucide-react'
import { AccountMenu } from '../../components/account-menu'
import { DesignIcon } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { api, ApiError, authenticatedFetch, errorMessage, readResponse, type Workspace } from '../../lib/api'
import { AnnotatedPreview } from './annotated-preview'
import { SourceSearch } from './source-search'
import { AcademicLibrary } from './academic-library'
import { InteractionPanel, type Mode } from './interaction-panel'
import { LearningPlanManager } from './learning-plan-manager'
import type { CitationTarget } from './pdf-preview'
import { PANEL_BOUNDS, usePanelResize } from './use-panel-resize'
import { ReaderDocumentBar, type RenameOutcome } from './reader-document-bar'
import { WORKSPACE_VIEWS, WorkspaceSidebar } from './workspace-sidebar'
import { type WorkspaceView, workspaceLocation } from '../../lib/workspace-location'

export type DocumentItem = {
  document_id: string
  workspace_id: string
  name: string
  filename: string
  media_type: string
  size_bytes: number
  preview_ready: boolean
  created_at: string
}

type Job = { kind: 'preview' | 'index'; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; error_code?: string | null }
type DocumentJobs = { preview?: Job['status']; index?: Job['status']; error?: string }

const filters = {
  all: 'All', succeeded: 'Ready', running: 'Processing', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled',
} as const
const vietnameseFilters: Record<keyof typeof filters, string> = {
  all: 'Tất cả', succeeded: 'Sẵn sàng', running: 'Đang xử lý', queued: 'Đang chờ', failed: 'Lỗi', cancelled: 'Đã hủy',
}
const jobColors: Record<Job['status'], string> = {
  succeeded: 'success', running: 'warning', queued: 'info', failed: 'danger', cancelled: 'neutral',
}

function summarizeDocumentJobs(doc: DocumentItem, jobs: Job[]): DocumentJobs {
  const previewStatus = jobs.find(j => j.kind === 'preview')?.status ?? (doc.preview_ready ? 'succeeded' : 'queued')
  const indexJob = jobs.find(j => j.kind === 'index')
  const failure = jobs.find(job => job.status === 'failed')
  return {
    preview: previewStatus,
    index: indexJob?.status ?? 'queued',
    error: failure?.error_code ?? undefined,
  }
}

export function DocumentShelf({ workspace, workspaces, email, accountId, items, selected, initialPage, initialView }: {
  workspace: Workspace
  workspaces: Workspace[]
  email: string
  accountId: string
  items: DocumentItem[]
  selected?: string
  initialPage: number
  initialView?: WorkspaceView
}) {
  const router = useRouter()
  const { language, text } = useWorkspaceLanguage()
  const defaultView: WorkspaceView = initialView === 'plans' ? 'chats' : initialView ?? (items.length ? 'chats' : 'library')
  const [documents, setDocuments] = useState(items)
  const [selectedId, setSelectedId] = useState<string | undefined>(selected ?? items[0]?.document_id)
  const [page, setPage] = useState(selected ? initialPage : 1)
  const [view, setView] = useState<WorkspaceView>(defaultView)
  const [learningPlans, setLearningPlans] = useState(false)
  const [learningPlanSlot, setLearningPlanSlot] = useState<HTMLDivElement | null>(null)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  useEffect(() => {
    let current = true
    void api<{ learning_plans: boolean }>('/v1/workspaces/' + workspace.workspace_id + '/workflow-features')
      .then(features => { if (current) setLearningPlans(features.learning_plans) })
      .catch(() => { if (current) setLearningPlans(false) })
    return () => { current = false }
  }, [workspace.workspace_id])
  const [requestedMode, setRequestedMode] = useState<{ mode: 'ASK' | 'PLAN'; nonce: number }>(() => ({
    mode: 'ASK',
    nonce: 0,
  }))
  const [activeTab, setActiveTab] = useState<'assistant' | 'sources' | 'reader'>(
    selected ? 'reader' : ['chats', 'history', 'learning-plans'].includes(defaultView) ? 'assistant' : 'sources'
  )
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const sourcesStorageKey = 'aipollo.selected-sources.' + workspace.workspace_id
  const hydratedWorkspaceRef = useRef<string | null>(null)
  useEffect(() => {
    const validIds = new Set(items.map(item => item.document_id))
    let restored: string[] = []
    try {
      const raw = window.sessionStorage.getItem(sourcesStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          restored = parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id))
        }
      }
    } catch {
      // Session storage may be blocked; keep empty initial sources.
    }
    hydratedWorkspaceRef.current = workspace.workspace_id
    setSelectedSources(restored)
  }, [workspace.workspace_id, sourcesStorageKey, items])
  useEffect(() => {
    if (hydratedWorkspaceRef.current !== workspace.workspace_id) return
    try {
      window.sessionStorage.setItem(sourcesStorageKey, JSON.stringify(selectedSources))
    } catch {
      // Session storage may be blocked.
    }
  }, [workspace.workspace_id, sourcesStorageKey, selectedSources])
  const [sourcesLocked, setSourcesLocked] = useState(false)
  const [readerVisible, setReaderVisible] = useState(true)
  const [annotationPending, setAnnotationPending] = useState(false)
  const [annotationDirty, setAnnotationDirty] = useState(false)
  const [citation, setCitation] = useState<CitationTarget>()
  const [filter, setFilter] = useState<keyof typeof filters>('all')
  const [documentJobs, setDocumentJobs] = useState<Record<string, DocumentJobs>>({})
  const latestJobs = useRef(documentJobs)
  const [pollVersion, setPollVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState(false)
  const [openedArtifact, setOpenedArtifact] = useState<string>()
  const [openedLearningPlan, setOpenedLearningPlan] = useState<string>()
  const uploadKey = useRef<string | null>(null)
  const uploadForm = useRef<HTMLFormElement>(null)
  const workspaceBody = useRef<HTMLDivElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const reader = useRef<HTMLElement>(null)
  const deletedIdsRef = useRef<Set<string>>(new Set())
  const { activeSide, bodyStyle, effectiveWidths, handleKeyDown, resetWidth, startResize } = usePanelResize({
    bodyRef: workspaceBody,
    sidebarRef: sidebar,
    readerRef: reader,
    readerVisible,
  })
  const mayWrite = workspace.role !== 'VIEWER'
  const selectedDoc = documents.find(item => item.document_id === selectedId)
  const base = `/v1/workspaces/${workspace.workspace_id}/documents`

  // Background polling for preview readiness and indexing jobs across workspace documents
  useEffect(() => {
    if (!documents.length) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let delay = 1500
    const controller = new AbortController()
    const poll = async <T,>(path: string): Promise<T> => readResponse<T>(await authenticatedFetch(path, { signal: controller.signal }))

    async function pollJobs() {
      const pendingDocs = documents.filter(doc => {
        if (deletedIdsRef.current.has(doc.document_id)) return false
        if (!doc.preview_ready) return true
        const jobs = latestJobs.current[doc.document_id]
        if (!jobs) return true
        return jobs.index === 'queued' || jobs.index === 'running'
      })

      if (!pendingDocs.length) return

      try {
        const updates = await mapConcurrent(pendingDocs, async doc => {
            if (!active) return null
            try {
              const updatedDoc = doc.preview_ready ? doc : await poll<DocumentItem>(`${base}/${doc.document_id}`)
              const jobs = await poll<Job[]>(`${base}/${doc.document_id}/jobs`)
              return { id: doc.document_id, doc: updatedDoc, ...summarizeDocumentJobs(updatedDoc, jobs) }
            } catch (err) {
              if (err instanceof ApiError && err.status === 401) {
                router.replace('/sign-in')
              }
              if (err instanceof ApiError && err.status === 404) {
                return { id: doc.document_id, deleted: true as const }
              }
              return null
            }
          })

        if (!active) return
        const deletedIds = new Set(
          updates
            .filter((item): item is { id: string; deleted: true } => item !== null && 'deleted' in item)
            .map(item => item.id)
        )
        const incomplete = updates.some(item => item === null)
        setPollError(incomplete)
        delay = incomplete ? Math.min(15000, delay * 2) : 1500

        let docsChanged = deletedIds.size > 0
        const nextDocs = documents.filter(doc => !deletedIds.has(doc.document_id))
        const nextJobs = { ...latestJobs.current }
        for (const id of deletedIds) {
          deletedIdsRef.current.add(id)
          delete nextJobs[id]
        }

        for (const item of updates) {
          if (!item || 'deleted' in item) continue
          nextJobs[item.id] = { preview: item.preview, index: item.index, error: item.error }
          if (item.doc.preview_ready) {
            const idx = nextDocs.findIndex(d => d.document_id === item.id)
            if (idx !== -1 && !nextDocs[idx].preview_ready) {
              nextDocs[idx] = item.doc
              docsChanged = true
            }
          }
        }

        if (docsChanged) {
          const updatedById = new Map(nextDocs.map(doc => [doc.document_id, doc]))
          setDocuments(current => current
            .filter(doc => !deletedIds.has(doc.document_id))
            .map(doc => updatedById.get(doc.document_id) ?? doc))
          if (deletedIds.size > 0) {
            setSelectedSources(current => current.filter(id => !deletedIds.has(id)))
          }
        }
        latestJobs.current = nextJobs
        setDocumentJobs(nextJobs)

        const stillPending = nextDocs.some(doc => {
          if (deletedIdsRef.current.has(doc.document_id)) return false
          if (!doc.preview_ready) return true
          const j = nextJobs[doc.document_id]
          return !j || j.index === 'queued' || j.index === 'running'
        })

        if (active && stillPending) {
          timer = setTimeout(pollJobs, delay)
        }
      } catch {
        if (active) {
          setPollError(true)
          delay = Math.min(15000, delay * 2)
          timer = setTimeout(pollJobs, delay)
        }
      }
    }

    void pollJobs()
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [base, documents, pollVersion, router])

  function select(id: string | undefined, nextPage = 1, switchMobileToReader = true): boolean {
    if (annotationPending && id !== selectedId) {
      setError(text(
        'Save or discard the pending annotation before changing documents.',
        'Hãy lưu hoặc hủy ghi chú đang chờ trước khi chuyển tài liệu.',
      ))
      return false
    }
    if (annotationDirty && id !== selectedId && !window.confirm(text(
      'You have an unsaved note draft. Discard draft and switch document?',
      'Bạn có ghi chú chưa lưu. Bỏ bản nháp và chuyển tài liệu?',
    ))) {
      return false
    }
    setError('')
    setSelectedId(id)
    setPage(nextPage)
    setCitation(undefined)
    window.history.replaceState(null, '', workspaceLocation(workspace.workspace_id, id, nextPage))
    if (switchMobileToReader) {
      setReaderVisible(true)
      setActiveTab('reader')
    }
    return true
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      setError(errorMessage(failure))
      if (failure instanceof ApiError && failure.status === 401) router.replace('/sign-in')
    } finally {
      setBusy(false)
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('file')
    if (file instanceof File) uploadFile(file)
  }

  function uploadFile(file: File) {
    if (!file.size || busy) return
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setError('Choose a PDF or DOCX document.')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('Files may be up to 25 MiB.')
      return
    }
    uploadKey.current ??= crypto.randomUUID()
    const key = uploadKey.current
    void run(async () => {
      const response = await authenticatedFetch(base, {
        method: 'POST', body: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': key,
          'X-Filename': encodeURIComponent(file.name),
        },
      })
      const document = await readResponse<DocumentItem>(response)
      setDocuments(current => [document, ...current.filter(item => item.document_id !== document.document_id)])
      select(document.document_id, 1, true)
      uploadKey.current = null
      uploadForm.current?.reset()
      setFileName('')
    })
  }

  async function renameDocument(id: string, name: string): Promise<RenameOutcome> {
    if (annotationPending && id === selectedId) {
      return {
        ok: false,
        error: text(
          'Save or discard the pending annotation before renaming.',
          'Hãy lưu hoặc hủy ghi chú đang chờ trước khi đổi tên.',
        ),
      }
    }
    setBusy(true)
    setError('')
    try {
      const document = await api<DocumentItem>(base + '/' + id, 'PATCH', { name })
      setDocuments(current => current.map(item => item.document_id === id ? document : item))
      return { ok: true }
    } catch (failure) {
      const message = errorMessage(failure)
      if (failure instanceof ApiError && failure.status === 401) router.replace('/sign-in')
      return { ok: false, error: message }
    } finally {
      setBusy(false)
    }
  }

  function remove(document: DocumentItem) {
    const id = document.document_id
    if (annotationPending && id === selectedId) {
      setError(text(
        'Save or discard the pending annotation before deleting.',
        'Hãy lưu hoặc hủy ghi chú đang chờ trước khi xóa tài liệu.',
      ))
      return
    }
    if (!window.confirm(text(`Delete “${document.name}”?`, `Xóa tài liệu “${document.name}”?`))) return
    deletedIdsRef.current.add(id)
    void run(async () => {
      try {
        await api(base + '/' + id, 'DELETE')
      } catch (failure) {
        if (!(failure instanceof ApiError && failure.status === 404)) {
          deletedIdsRef.current.delete(id)
          throw failure
        }
      }
      const remaining = documents.filter(item => item.document_id !== id)
      setDocuments(current => current.filter(item => item.document_id !== id))
      setSelectedSources(current => current.filter(sourceId => sourceId !== id))
      setDocumentJobs(current => {
        const next = { ...current }
        delete next[id]
        latestJobs.current = next
        return next
      })
      if (selectedId === id) {
        select(remaining[0]?.document_id, 1, false)
      } else if (citation?.document_id === id) {
        setCitation(undefined)
      }
    })
  }

  function retryDocument(document: DocumentItem) {
    const id = document.document_id
    void run(async () => {
      let jobs: Job[]
      try {
        jobs = await api<Job[]>(base + '/' + id + '/retry', 'POST')
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          jobs = await api<Job[]>(base + '/' + id + '/jobs')
        } else {
          throw failure
        }
      }
      const nextEntry = summarizeDocumentJobs(document, jobs)
      setDocumentJobs(current => {
        const next = { ...current, [id]: nextEntry }
        latestJobs.current = next
        return next
      })
      setPollVersion(version => version + 1)
    })
  }

  function download(id: string) {
    void run(async () => {
      const url = base + '/' + id + '/original'
      const response = await authenticatedFetch(url, { method: 'HEAD' })
      if (!response.ok) await readResponse(response)
      window.location.assign(url)
    })
  }

  function navigate(next: WorkspaceView) {
    setMobileNavigationOpen(false)
    setView(next)
    setActiveTab(['chats', 'learning-plans', 'history'].includes(next) ? 'assistant' : 'sources')
    if (next === 'chats') {
      setRequestedMode(current => ({ mode: 'ASK', nonce: current.nonce + 1 }))
    }
  }

  function handleAssistantModeChange(nextMode: Mode) {
    setView(current => {
      if (current !== 'chats' && current !== 'plans') return current
      return nextMode === 'PLAN' ? 'plans' : 'chats'
    })
  }

  function openUpload() {
    navigate('library')
    uploadForm.current?.querySelector<HTMLInputElement>('input')?.click()
  }

  function updateSource(id: string, checked: boolean) {
    setSelectedSources(current => checked
      ? [...new Set([...current, id])]
      : current.filter(item => item !== id))
  }

  const sourceState = (doc: DocumentItem): Job['status'] => {
    const jobs = documentJobs[doc.document_id]
    if (jobs?.preview === 'failed') return 'failed'
    return jobs?.index ?? jobs?.preview ?? 'queued'
  }
  const readySources = documents.filter(doc => sourceState(doc) === 'succeeded').map(doc => doc.document_id)
  const selectedPreviewJob = selectedDoc && documentJobs[selectedDoc.document_id]?.preview
  function openCitation(target: CitationTarget) {
    if (!select(target.document_id, target.page, true)) return
    setCitation(target)
    requestAnimationFrame(() => reader.current?.focus({ preventScroll: true }))
  }

  return (
    <>
      <AccountMenu compact workspace email={email} search={[
        ...workspaces.map(item => ({
          name: item.name, href: workspaceLocation(item.workspace_id), kind: 'Workspace' as const,
        })),
        ...documents.map(item => ({
          name: item.name, href: workspaceLocation(workspace.workspace_id, item.document_id, 1),
          kind: 'Source' as const, documentId: item.document_id,
        })),
      ]} onSelectSource={id => select(id)} />
      <main className="app-workspace aipollo-workspace" lang={language}>
        <nav className="workspace-tab-nav" aria-label="Workspace views" role="tablist">
          {([
            ['assistant', text('Assistant', 'Trợ lý'), 'chats'],
            ['sources', text('Sources', 'Nguồn'), 'library'],
            ['reader', text('Reader', 'Trình đọc'), 'panel'],
          ] as const).map(([id, label, icon]) => (
            <button key={id} type="button" role="tab" id={'tab-' + id}
              aria-controls={id === 'reader' ? 'panel-reader' : 'panel-main'} aria-selected={activeTab === id}
              className="workspace-tab-btn" onClick={() => {
                if (id === 'assistant') navigate('chats')
                else if (id === 'sources') navigate('library')
                else { setActiveTab('reader'); setReaderVisible(true) }
              }}>
              <DesignIcon name={icon} /> {label}
            </button>
          ))}
        </nav>
        {learningPlans && activeTab !== 'reader' && <button type="button" className="secondary sm workspace-mobile-nav-toggle"
          aria-expanded={mobileNavigationOpen} aria-controls="workspace-navigation"
          onClick={() => setMobileNavigationOpen(open => !open)}>
          {mobileNavigationOpen ? text('Hide workspace navigation', 'Ẩn điều hướng không gian làm việc')
            : text('Show workspace navigation', 'Mở điều hướng không gian làm việc')}
        </button>}

        <div
          ref={workspaceBody}
          className="workspace-body"
          data-reader-visible={readerVisible}
          data-resizing={activeSide ? 'true' : undefined}
          style={bodyStyle}
        >
          <WorkspaceSidebar
            sidebarRef={sidebar}
            workspace={workspace}
            workspaces={workspaces}
            mayWrite={mayWrite}
            learningPlans={learningPlans}
            onLearningPlanSlot={setLearningPlanSlot}
            mobileOpen={mobileNavigationOpen && activeTab !== 'reader'}
            view={view}
            documents={documents}
            selectedId={selectedId}
            selectedSources={selectedSources}
            sourcesLocked={sourcesLocked}
            sourceState={doc => sourceState(documents.find(item => item.document_id === doc.document_id) ?? ({ ...doc, workspace_id: workspace.workspace_id, filename: doc.name, media_type: 'application/pdf', size_bytes: 0, preview_ready: false, created_at: '' }))}
            onUpload={openUpload}
            onNavigate={navigate}
            onToggleSource={updateSource}
            onOpenDocument={id => select(id, 1, true)}
          />
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={text('Resize navigation sidebar', 'Thay đổi độ rộng thanh điều hướng')}
            aria-valuemin={PANEL_BOUNDS.sidebar.min}
            aria-valuemax={PANEL_BOUNDS.sidebar.max}
            aria-valuenow={effectiveWidths.sidebar ?? 264}
            className="workspace-resizer"
            data-side="sidebar"
            data-dragging={activeSide === 'sidebar' ? 'true' : undefined}
            onPointerDown={event => startResize('sidebar', event)}
            onDoubleClick={() => resetWidth('sidebar')}
            onKeyDown={event => handleKeyDown('sidebar', event)}
          />

          <div id="panel-main" className="workspace-center" data-mobile-active={activeTab !== 'reader'}>
            <nav className="workspace-compact-nav" aria-label="Workspace sections">
              {WORKSPACE_VIEWS.filter(item => item.id !== 'learning-plans' || learningPlans).map(item => (
                <button
                  className="workspace-nav-item"
                  key={item.id}
                  type="button"
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <DesignIcon name={view === item.id ? item.activeIcon ?? item.icon : item.icon} />
                  <span>{text(item.label, item.vietnamese)}</span>
                </button>
              ))}
              <Link href="/workspaces" aria-label="Back to workspaces">{text('Workspaces', 'Không gian làm việc')}</Link>
            </nav>
            {!readerVisible && <button type="button" className="secondary sm reader-open"
              onClick={() => setReaderVisible(true)}><DesignIcon name="panel" /> Show reader</button>}
            <div className="workspace-chat" hidden={view !== 'chats' && view !== 'history'}>
              <InteractionPanel workspaceId={workspace.workspace_id} workspaceName={workspace.name} accountId={accountId}
                documents={documents} readySources={readySources} selectedSources={selectedSources} setSelectedSources={setSelectedSources}
                onSourcesLock={setSourcesLocked} showHistory={view === 'history'}
                learningPlansVisible={view === 'chats'}
                learningPlanSlot={learningPlanSlot}
                requestedMode={requestedMode} onModeChange={handleAssistantModeChange}
                canPublish={mayWrite} onCitation={openCitation} onOpenLearningPlan={id => {
                  setOpenedLearningPlan(id)
                  navigate('learning-plans')
                }} onOpenArtifact={id => {
                  setOpenedArtifact(id)
                  navigate('artifacts')
                }} />
            </div>
            {learningPlans && view === 'learning-plans' && <LearningPlanManager workspaceId={workspace.workspace_id} initialPlanId={openedLearningPlan} />}

            <section className="aipollo-library form-stack" hidden={view !== 'library'} aria-labelledby="documents-heading">
              <header className="aipollo-section-heading">
                <div><h1 id="documents-heading">{text('Library', 'Thư viện')}</h1>
                  <p>{workspace.name} · {documents.length} {text('sources', 'nguồn')}</p></div>
                {mayWrite && <button type="button" onClick={openUpload}>{text('Upload source', 'Tải tài liệu lên')}</button>}
              </header>
              {mayWrite && <form className="upload-drop" method="post" onSubmit={upload} ref={uploadForm}
                onDragOver={event => event.preventDefault()} onDrop={event => {
                  event.preventDefault()
                  const file = event.dataTransfer.files[0]
                  if (file) { uploadKey.current = null; uploadFile(file) }
                }}>
                <label htmlFor="workspace-upload-file"><DesignIcon name="upload-drop" /> {text('Drop PDF or DOCX here', 'Thả tệp PDF hoặc DOCX vào đây')}</label>
                <p className="muted">{text('Maximum file size 25 MiB', 'Dung lượng tối đa 25 MiB')}</p>
                <input id="workspace-upload-file" aria-label="Document file" type="file" name="file"
                  accept=".pdf,.docx" required disabled={busy} onChange={event => {
                    uploadKey.current = null
                    setFileName(event.currentTarget.files?.[0]?.name ?? '')
                  }} />
                {fileName && <div className="upload-selection">
                  <span className="muted">{fileName}</span>
                  <button type="submit" className="sm" disabled={busy}>{text('Upload document', 'Tải lên')}</button>
                </div>}
              </form>}
              {error && view === 'library' && <p role="alert"><DesignIcon name="error" /> {error}</p>}
              {pollError && <p role="alert">{text('Could not update document status. Retrying with backoff.', 'Chưa cập nhật được trạng thái tài liệu. Hệ thống sẽ thử lại.')}</p>}
              <div className="library-filters" aria-label="Filter source status">
                {Object.entries(filters).map(([value, label]) => {
                  const count = value === 'all' ? documents.length : documents.filter(doc => sourceState(doc) === value).length
                  if (value === 'cancelled' && !count) return null
                  return <button key={value} type="button" aria-pressed={filter === value}
                    onClick={() => setFilter(value as keyof typeof filters)}>{text(label, vietnameseFilters[value as keyof typeof filters])} {count}</button>
                })}
              </div>
              <div className="aipollo-table-scroll">
                <table className="aipollo-table">
                  <thead><tr><th scope="col">{text('Name', 'Tên')}</th><th scope="col">{text('Type', 'Loại')}</th><th scope="col">{text('Preview', 'Xem trước')}</th><th scope="col">{text('AI index', 'Chỉ mục AI')}</th><th scope="col">{text('Action', 'Thao tác')}</th></tr></thead>
                  <tbody>{documents.filter(doc => filter === 'all' || sourceState(doc) === filter).map(doc => {
                    const state = sourceState(doc)
                    return <tr key={doc.document_id}>
                      <th scope="row"><span className="aipollo-table-file"><DesignIcon name="file" /> {doc.name}</span></th>
                      <td>{doc.filename.toLowerCase().endsWith('.docx') ? 'DOCX' : 'PDF'}</td>
                      <td>{doc.preview_ready ? text('Ready to view', 'Có thể xem') : text('Preparing preview', 'Đang chuẩn bị')}</td>
                      <td><span className={'badge badge-' + jobColors[state]}>{text(filters[state], vietnameseFilters[state])}</span>
                        {documentJobs[doc.document_id]?.error && <div className="muted">
                          {documentJobs[doc.document_id].error === 'parse_timeout' ? text('Processing time limit exceeded. Preview remains available.', 'Vượt thời gian xử lý. Bạn vẫn có thể xem tài liệu.') : documentJobs[doc.document_id].error === 'no_text' ? text('No text found. Scanned PDFs need OCR, which is not enabled.', 'Không tìm thấy văn bản. PDF scan cần OCR, hiện chưa hỗ trợ.') : documentJobs[doc.document_id].error?.replaceAll('_', ' ')}
                        </div>}</td>
                      <td>
                        <div className="actions">
                          {doc.preview_ready && <button type="button" className="secondary sm" aria-label={text('Open ' + doc.name, 'Mở ' + doc.name)}
                            onClick={() => select(doc.document_id)}>{text('Open', 'Mở')}</button>}
                          {mayWrite && state === 'failed' && <button type="button" className="secondary sm" disabled={busy}
                            aria-label={text('Retry ' + doc.name, 'Thử lại ' + doc.name)}
                            onClick={() => retryDocument(doc)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <RefreshCw size={13} aria-hidden="true" />
                            <span>{text('Retry', 'Thử lại')}</span>
                          </button>}
                          {mayWrite && <button type="button" className="danger sm" disabled={busy}
                            aria-label={text('Delete ' + doc.name, 'Xóa ' + doc.name)}
                            onClick={() => remove(doc)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <Trash2 size={13} aria-hidden="true" />
                            <span>{text('Delete', 'Xóa')}</span>
                          </button>}
                        </div>
                      </td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
              {!documents.length && <p className="muted">There are no documents in this workspace.</p>}
              {documents.length > 0 && filter !== 'all' && !documents.some(doc => sourceState(doc) === filter) &&
                <p className="muted">No sources with this status.</p>}
              {!!documents.length && <details className="library-source-search">
                <summary><DesignIcon name="search" /> {text('Search sources', 'Tìm trong các nguồn')}</summary>
                <SourceSearch workspaceId={workspace.workspace_id} documents={documents.filter(doc => readySources.includes(doc.document_id))} onCitation={openCitation} />
              </details>}
            </section>

            <div className="library-academic" hidden={view !== 'artifacts' && view !== 'references'}>
              <AcademicLibrary openedArtifact={openedArtifact} workspace={workspace} view={view === 'references' || view === 'artifacts' ? view : undefined} onCitation={openCitation} />
            </div>
            {view === 'notes' && <section className="form-stack">
              <header className="aipollo-section-heading"><div><h1>{text('Notes', 'Ghi chú')}</h1><p>{workspace.name}</p></div></header>
              <p className="muted">{selectedDoc
                ? text('View and edit personal page notes in the document reader.', 'Xem và chỉnh sửa ghi chú trang cá nhân trong trình đọc tài liệu.')
                : text('Add a source to write a page note.', 'Thêm tài liệu để viết ghi chú trang.')}</p>
              {selectedDoc && <button type="button" className="secondary sm"
                onClick={() => {
                  setReaderVisible(true)
                  setActiveTab('reader')
                  requestAnimationFrame(() => {
                    const body = document.getElementById('annotation-body')
                    if (body) {
                      body.focus()
                      return
                    }
                    const toggle = reader.current?.querySelector<HTMLButtonElement>('.annotations-bar-toggle')
                    if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
                      toggle.click()
                    }
                    toggle?.focus()
                  })
                }}>{text('Open page notes', 'Mở ghi chú trang')}</button>}
            </section>}
          </div>
          <div
            role="separator"
            tabIndex={readerVisible ? 0 : -1}
            hidden={!readerVisible}
            aria-orientation="vertical"
            aria-label={text('Resize document reader', 'Thay đổi độ rộng trình đọc tài liệu')}
            aria-valuemin={PANEL_BOUNDS.reader.min}
            aria-valuemax={PANEL_BOUNDS.reader.max}
            aria-valuenow={effectiveWidths.reader ?? 420}
            className="workspace-resizer"
            data-side="reader"
            data-dragging={activeSide === 'reader' ? 'true' : undefined}
            onPointerDown={event => startResize('reader', event)}
            onDoubleClick={() => resetWidth('reader')}
            onKeyDown={event => handleKeyDown('reader', event)}
          />

          <aside id="panel-reader" ref={reader} tabIndex={-1} aria-label="Document preview" role="region" className="workspace-reader"
            data-mobile-active={activeTab === 'reader'} hidden={!readerVisible}>
            <ReaderDocumentBar
              documents={documents}
              selectedDoc={selectedDoc}
              busy={busy}
              mayWrite={mayWrite}
              annotationPending={annotationPending}
              onSelect={id => select(id)}
              onDownload={download}
              onRename={renameDocument}
              onDelete={remove}
              onHideReader={() => {
                if (annotationPending) return
                if (annotationDirty && !window.confirm(text(
                  'You have an unsaved note draft. Discard draft and hide reader?',
                  'Bạn có ghi chú chưa lưu. Bỏ bản nháp và ẩn trình đọc?',
                ))) return
                setReaderVisible(false)
              }}
            />
            {selectedDoc ? <>
              {error && view !== 'library' && <p role="alert"><DesignIcon name="error" /> {error}</p>}
              {selectedDoc.preview_ready ? <AnnotatedPreview key={'preview-' + selectedDoc.document_id}
                onPendingChange={setAnnotationPending} onDirtyChange={setAnnotationDirty} documentUrl={base + '/' + selectedDoc.document_id} page={page}
                citation={citation} onClearCitation={() => setCitation(current => current ? { ...current, region: undefined, regions: undefined } : undefined)}
                onPage={next => select(selectedDoc.document_id, next, false)} /> : (
                <p role="status" className="reader-empty">{selectedPreviewJob === 'failed' ? 'Preview could not be generated.'
                  : selectedPreviewJob === 'cancelled' ? 'Preview was cancelled.'
                  : selectedPreviewJob === 'running' ? 'Generating PDF preview…' : 'PDF preview is queued.'}</p>
              )}
            </> : citation ? (
              <section className="reader-empty form-stack" aria-label={text('Unavailable citation source', 'Nguồn trích dẫn không còn khả dụng')}>
                <p className="muted">
                  {text(
                    'This source document has been deleted from the workspace. The saved citation snapshot is preserved below.',
                    'Tài liệu nguồn này đã bị xóa khỏi workspace. Nội dung trích dẫn đã lưu vẫn được giữ lại bên dưới.'
                  )}
                </p>
                <div className="reader-annotations form-stack">
                  <h3>
                    <DesignIcon name="annotate" /> {citation.name ? `${citation.name} · ` : ''}{text('p.', 'tr.')} {citation.page}
                  </h3>
                  {citation.text && <p className="muted">{citation.text}</p>}
                </div>
              </section>
            ) : <p className="reader-empty muted">{text('Select a document to preview it.', 'Chọn một tài liệu để xem trước.')}</p>}
          </aside>
        </div>
      </main>
    </>
  )
}
