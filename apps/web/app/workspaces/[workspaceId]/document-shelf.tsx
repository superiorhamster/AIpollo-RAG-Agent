'use client'

import Link from 'next/link'
import { mapConcurrent } from '../../lib/polling'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AccountMenu } from '../../components/account-menu'
import { DesignIcon, type IconName } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { api, ApiError, authenticatedFetch, errorMessage, readResponse, type Workspace } from '../../lib/api'
import { workspaceLocation } from '../../lib/workspace-location'
import { AnnotatedPreview } from './annotated-preview'
import { SourceSearch } from './source-search'
import { AcademicLibrary } from './academic-library'
import { InteractionPanel } from './interaction-panel'
import type { CitationTarget } from './pdf-preview'

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
type View = 'chats' | 'library' | 'notes' | 'artifacts' | 'references' | 'history'

const views: { id: View; label: string; vietnamese: string; icon: IconName; activeIcon?: IconName }[] = [
  { id: 'chats', label: 'Chats', vietnamese: 'Trò chuyện', icon: 'chats', activeIcon: 'chats-active' },
  { id: 'library', label: 'Library', vietnamese: 'Thư viện', icon: 'library', activeIcon: 'library-active' },
  { id: 'notes', label: 'Notes', vietnamese: 'Ghi chú', icon: 'notes' },
  { id: 'artifacts', label: 'Artifacts', vietnamese: 'Sản phẩm', icon: 'artifacts', activeIcon: 'artifacts-active' },
  { id: 'references', label: 'References', vietnamese: 'Tài liệu tham khảo', icon: 'references' },
  { id: 'history', label: 'History', vietnamese: 'Lịch sử', icon: 'history' },
]
const filters = {
  all: 'All', succeeded: 'Ready', running: 'Processing', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled',
} as const
const vietnameseFilters: Record<keyof typeof filters, string> = {
  all: 'Tất cả', succeeded: 'Sẵn sàng', running: 'Đang xử lý', queued: 'Đang chờ', failed: 'Lỗi', cancelled: 'Đã hủy',
}
const jobColors: Record<Job['status'], string> = {
  succeeded: 'success', running: 'warning', queued: 'info', failed: 'danger', cancelled: 'neutral',
}

export function DocumentShelf({ workspace, workspaces, email, items, selected, initialPage }: {
  workspace: Workspace
  workspaces: Workspace[]
  email: string
  items: DocumentItem[]
  selected?: string
  initialPage: number
}) {
  const router = useRouter()
  const { language, text } = useWorkspaceLanguage()
  const [documents, setDocuments] = useState(items)
  const [selectedId, setSelectedId] = useState<string | undefined>(selected ?? items[0]?.document_id)
  const [page, setPage] = useState(selected ? initialPage : 1)
  const [view, setView] = useState<View>(items.length ? 'chats' : 'library')
  const [activeTab, setActiveTab] = useState<'assistant' | 'sources' | 'reader'>(
    selected ? 'reader' : items.length ? 'assistant' : 'sources'
  )
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [sourcesLocked, setSourcesLocked] = useState(false)
  const [readerVisible, setReaderVisible] = useState(true)
  const [citation, setCitation] = useState<CitationTarget>()
  const [filter, setFilter] = useState<keyof typeof filters>('all')
  const [documentJobs, setDocumentJobs] = useState<Record<string, DocumentJobs>>({})
  const latestJobs = useRef(documentJobs)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState(false)
  const [openedArtifact, setOpenedArtifact] = useState<string>()
  const uploadKey = useRef<string | null>(null)
  const uploadForm = useRef<HTMLFormElement>(null)
  const reader = useRef<HTMLElement>(null)
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
              const previewStatus = jobs.find(j => j.kind === 'preview')?.status ?? (updatedDoc.preview_ready ? 'succeeded' : 'queued')
              const indexJob = jobs.find(j => j.kind === 'index')
              const failure = jobs.find(job => job.status === 'failed')
              return { id: doc.document_id, doc: updatedDoc, preview: previewStatus,
                index: indexJob?.status ?? 'queued', error: failure?.error_code ?? undefined }
            } catch (err) {
              if (err instanceof ApiError && err.status === 401) {
                router.replace('/sign-in')
              }
              return null
            }
          })

        if (!active) return
        const incomplete = updates.some(item => item === null)
        setPollError(incomplete)
        delay = incomplete ? Math.min(15000, delay * 2) : 1500

        let docsChanged = false
        const nextDocs = [...documents]
        const nextJobs = { ...latestJobs.current }

        for (const item of updates) {
          if (!item) continue
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
          setDocuments(nextDocs)
        }
        latestJobs.current = nextJobs
        setDocumentJobs(nextJobs)

        const stillPending = nextDocs.some(doc => {
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
  }, [base, documents, router])

  function select(id: string | undefined, nextPage = 1, switchMobileToReader = true) {
    setSelectedId(id)
    setPage(nextPage)
    setCitation(undefined)
    window.history.replaceState(null, '', workspaceLocation(workspace.workspace_id, id, nextPage))
    if (switchMobileToReader) {
      setReaderVisible(true)
      setActiveTab('reader')
    }
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

  function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    void run(async () => {
      const document = await api<DocumentItem>(base + '/' + id, 'PATCH', { name })
      setDocuments(current => current.map(item => item.document_id === id ? document : item))
    })
  }

  function remove(document: DocumentItem) {
    if (!window.confirm(`Delete “${document.name}”?`)) return
    void run(async () => {
      await api(base + '/' + document.document_id, 'DELETE')
      const remaining = documents.filter(item => item.document_id !== document.document_id)
      setDocuments(remaining)
      setSelectedSources(current => current.filter(id => id !== document.document_id))
      if (selectedId === document.document_id) select(remaining[0]?.document_id, 1, false)
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

  function navigate(next: View) {
    setView(next)
    setActiveTab(next === 'chats' || next === 'history' ? 'assistant' : 'sources')
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
    select(target.document_id, target.page, true)
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

        <div className="workspace-body" data-reader-visible={readerVisible}>
          <aside className="workspace-sidebar" aria-label="Workspace navigation">
            {mayWrite && <button className="workspace-upload" type="button" onClick={openUpload}>
              <DesignIcon name="upload" /> {text('Upload source', 'Tải tài liệu lên')}
            </button>}
            <nav className="workspace-nav" aria-label="Workspace sections">
              {views.map(item => (
                <button className="workspace-nav-item" key={item.id} type="button"
                  aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
                  <DesignIcon name={view === item.id ? item.activeIcon ?? item.icon : item.icon} /> {text(item.label, item.vietnamese)}
                </button>
              ))}
            </nav>
            <Link href="/workspaces" className="workspace-nav-caption" aria-label="Back to workspaces">{text('Workspaces', 'Không gian làm việc')}</Link>
            <ul className="workspace-links">
              {workspaces.map(item => {
                const current = item.workspace_id === workspace.workspace_id
                return <li key={item.workspace_id}><Link
                  href={workspaceLocation(item.workspace_id, undefined, 1)} aria-current={current ? 'page' : undefined}>
                  <DesignIcon name={current ? 'folder-active' : 'folder'} /> <span>{item.name}</span>
                </Link></li>
              })}
            </ul>
            <fieldset className="workspace-sources" disabled={sourcesLocked}>
              <legend className="workspace-nav-caption">{text('Sources', 'Nguồn')} · {text(`${selectedSources.length} of ${documents.length} active`, `đã chọn ${selectedSources.length}/${documents.length}`)}</legend>
              {documents.map(doc => {
                const checked = selectedSources.includes(doc.document_id)
                const state = sourceState(doc)
                return <label className="workspace-source" key={doc.document_id} data-checked={checked}>
                  <input type="checkbox" aria-label={doc.name} checked={checked} disabled={state !== 'succeeded'}
                    onChange={event => updateSource(doc.document_id, event.currentTarget.checked)} />
                  <DesignIcon name="file" /><span className="source-name" title={doc.name}>{doc.name}</span>
                  {state !== 'succeeded' && <span className={'badge badge-' + jobColors[state]}>{text(filters[state], vietnameseFilters[state])}</span>}
                </label>
              })}
            </fieldset>
          </aside>

          <div id="panel-main" className="workspace-center" data-mobile-active={activeTab !== 'reader'}>
            <nav className="workspace-compact-nav" aria-label="Workspace sections">
              {views.map(item => <button className="workspace-nav-item" key={item.id} type="button"
                aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
                <DesignIcon name={item.icon} /> {text(item.label, item.vietnamese)}
              </button>)}
              <Link href="/workspaces" aria-label="Back to workspaces">{text('Workspaces', 'Không gian làm việc')}</Link>
            </nav>
            {!readerVisible && <button type="button" className="secondary sm reader-open"
              onClick={() => setReaderVisible(true)}><DesignIcon name="panel" /> Show reader</button>}
            <div className="workspace-chat" hidden={view !== 'chats' && view !== 'history'}>
              <InteractionPanel workspaceId={workspace.workspace_id} workspaceName={workspace.name}
                documents={documents} readySources={readySources} selectedSources={selectedSources} setSelectedSources={setSelectedSources}
                onSourcesLock={setSourcesLocked} showHistory={view === 'history'}
                canPublish={mayWrite} onCitation={openCitation} onOpenArtifact={id => {
                  setOpenedArtifact(id)
                  navigate('artifacts')
                }} />
            </div>

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
                      <td>{doc.preview_ready && <button type="button" className="secondary sm" aria-label={'Open ' + doc.name}
                        onClick={() => select(doc.document_id)}>{text('Open', 'Mở')}</button>}</td>
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
              <p className="muted">{selectedDoc ? 'View and edit personal page notes in the document reader.' : 'Add a source to write a page note.'}</p>
              {selectedDoc && <button type="button" className="secondary sm"
                onClick={() => { setReaderVisible(true); setActiveTab('reader'); requestAnimationFrame(() => {
                  document.getElementById('annotation-body')?.focus()
                }) }}>Open page notes</button>}
            </section>}
          </div>

          <aside id="panel-reader" ref={reader} tabIndex={-1} aria-label="Document preview" role="region" className="workspace-reader"
            data-mobile-active={activeTab === 'reader'} hidden={!readerVisible}>
            <div className="reader-topline">
              <nav className="reader-documents" aria-label="Preview sources">
                {documents.map(doc => <button key={doc.document_id} type="button" title={doc.name}
                  aria-pressed={selectedId === doc.document_id} onClick={() => select(doc.document_id)}>
                  {doc.name}
                </button>)}
              </nav>
              <button type="button" className="ghost reader-hide" aria-label="Hide reader" onClick={() => setReaderVisible(false)}>
                <DesignIcon name="panel" />
              </button>
            </div>
            {selectedDoc ? <>
              <details className="reader-file-menu" key={'file-menu-' + selectedDoc.document_id}>
                <summary><h2>{selectedDoc.name}</h2></summary>
                <div className="actions">
                  <button type="button" className="secondary sm" disabled={busy}
                    onClick={() => download(selectedDoc.document_id)}>Download original</button>
                  {mayWrite && <button type="button" className="danger sm" disabled={busy}
                    onClick={() => remove(selectedDoc)}>Delete document</button>}
                </div>
                {mayWrite && <form className="inline-form" method="post"
                  onSubmit={event => rename(event, selectedDoc.document_id)}>
                  <label>Document name<input name="name" defaultValue={selectedDoc.name} maxLength={200} required /></label>
                  <button type="submit" disabled={busy} className="sm">Save name</button>
                </form>}
              </details>
              {error && view !== 'library' && <p role="alert"><DesignIcon name="error" /> {error}</p>}
              {selectedDoc.preview_ready ? <AnnotatedPreview key={'preview-' + selectedDoc.document_id}
                documentUrl={base + '/' + selectedDoc.document_id} page={page}
                citation={citation} onClearCitation={() => setCitation(current => current ? { ...current, region: undefined, regions: undefined } : undefined)}
                onPage={next => select(selectedDoc.document_id, next, false)} /> : (
                <p role="status" className="reader-empty">{selectedPreviewJob === 'failed' ? 'Preview could not be generated.'
                  : selectedPreviewJob === 'cancelled' ? 'Preview was cancelled.'
                  : selectedPreviewJob === 'running' ? 'Generating PDF preview…' : 'PDF preview is queued.'}</p>
              )}
            </> : <p className="reader-empty muted">Select a document to preview it.</p>}
          </aside>
        </div>
      </main>
    </>
  )
}
