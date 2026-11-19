'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError, authenticatedFetch, errorMessage, readResponse, type Workspace } from '../../lib/api'
import { workspaceLocation } from '../../lib/workspace-location'
import { AnnotatedPreview } from './annotated-preview'
import { SourceSearch } from './source-search'
import { AcademicLibrary } from './academic-library'
import { InteractionPanel } from './interaction-panel'

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

type Job = { kind: 'preview' | 'index'; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' }

export function DocumentShelf({ workspace, items, selected, initialPage }: {
  workspace: Workspace
  items: DocumentItem[]
  selected?: string
  initialPage: number
}) {
  const router = useRouter()
  const [documents, setDocuments] = useState(items)
  const [selectedId, setSelectedId] = useState<string | undefined>(selected ?? items[0]?.document_id)
  const [page, setPage] = useState(selected ? initialPage : 1)
  const [activeTab, setActiveTab] = useState<'assistant' | 'sources' | 'reader'>(
    selected ? 'reader' : (items.length ? 'assistant' : 'sources')
  )
  const [documentJobs, setDocumentJobs] = useState<Record<string, { preview?: Job['status']; index?: Job['status'] }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const uploadKey = useRef<string | null>(null)
  const mayWrite = workspace.role !== 'VIEWER'
  const selectedDoc = documents.find(item => item.document_id === selectedId)
  const base = `/v1/workspaces/${workspace.workspace_id}/documents`

  // Background polling for preview readiness and indexing jobs across workspace documents
  useEffect(() => {
    if (!documents.length) return
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function pollJobs() {
      const pendingDocs = documents.filter(doc => {
        if (!doc.preview_ready) return true
        const jobs = documentJobs[doc.document_id]
        if (!jobs) return true
        return jobs.index === 'queued' || jobs.index === 'running'
      })

      if (!pendingDocs.length) return

      try {
        const updates = await Promise.all(
          pendingDocs.map(async doc => {
            try {
              const [updatedDoc, jobs] = await Promise.all([
                doc.preview_ready ? doc : api<DocumentItem>(`${base}/${doc.document_id}`),
                api<Job[]>(`${base}/${doc.document_id}/jobs`),
              ])
              const previewStatus = jobs.find(j => j.kind === 'preview')?.status ?? (updatedDoc.preview_ready ? 'succeeded' : 'queued')
              const indexStatus = jobs.find(j => j.kind === 'index')?.status ?? 'queued'
              return { id: doc.document_id, doc: updatedDoc, preview: previewStatus, index: indexStatus }
            } catch (err) {
              if (err instanceof ApiError && err.status === 401) {
                router.replace('/sign-in')
              }
              return null
            }
          })
        )

        if (!active) return

        let docsChanged = false
        const nextDocs = [...documents]
        const nextJobs = { ...documentJobs }

        for (const item of updates) {
          if (!item) continue
          nextJobs[item.id] = { preview: item.preview, index: item.index }
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
        setDocumentJobs(nextJobs)

        const stillPending = nextDocs.some(doc => {
          if (!doc.preview_ready) return true
          const j = nextJobs[doc.document_id]
          return !j || j.index === 'queued' || j.index === 'running'
        })

        if (active && stillPending) {
          timer = setTimeout(pollJobs, 1500)
        }
      } catch {
        // Continue
      }
    }

    void pollJobs()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [base, documents, documentJobs, router])

  function select(id: string | undefined, nextPage = 1, switchMobileToReader = true) {
    setSelectedId(id)
    setPage(nextPage)
    window.history.replaceState(null, '', workspaceLocation(workspace.workspace_id, id, nextPage))
    if (switchMobileToReader) {
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
    const form = event.currentTarget
    const file = new FormData(form).get('file')
    if (!(file instanceof File) || !file.size) return
    if (file.size > 25 * 1024 * 1024) {
      setError('Files may be up to 25 MiB.')
      return
    }
    uploadKey.current ??= crypto.randomUUID()
    const key = uploadKey.current
    void run(async () => {
      const response = await authenticatedFetch(base, {
        method: 'POST', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': key,
          'X-Filename': encodeURIComponent(file.name) },
      })
      const document = await readResponse<DocumentItem>(response)
      setDocuments(current => [document, ...current.filter(item => item.document_id !== document.document_id)])
      select(document.document_id, 1, true)
      uploadKey.current = null
      form.reset()
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
      select(remaining[0]?.document_id, 1, false)
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

  const selectedPreviewJob = selectedDoc ? documentJobs[selectedDoc.document_id]?.preview : undefined

  return (
    <>
      <style>{`
        .workspace-layout-root {
          display: grid;
          gap: 1.25rem;
        }
        .workspace-tab-nav {
          display: none;
        }
        .workspace-tab-btn {
          flex: 1;
          padding: 0.6rem 0.85rem;
          font-size: 0.92rem;
          font-weight: 600;
          text-align: center;
          border: 1px solid var(--line);
          background: var(--surface);
          color: var(--ink);
          border-radius: 0.45rem;
          cursor: pointer;
        }
        .workspace-tab-btn.active, .workspace-tab-btn[aria-selected="true"] {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .workspace-layout {
          display: grid;
          grid-template-columns: minmax(360px, 1.2fr) minmax(380px, 1.4fr);
          gap: 1.5rem;
          align-items: start;
        }
        .workspace-main-area {
          display: grid;
          gap: 1.5rem;
        }
        .workspace-reader-panel {
          display: grid;
          gap: 1rem;
        }
        .document-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 0.5rem;
        }
        .document-list-item {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.5rem 0.65rem;
          border: 1px solid var(--line);
          border-radius: 0.45rem;
          background: var(--surface);
        }
        .document-list-item.selected {
          border-color: var(--accent);
          background: #f8faff;
        }
        .document-select-btn {
          text-align: left;
          width: 100%;
          overflow-wrap: anywhere;
        }
        .document-badges {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.15rem 0.5rem;
          border-radius: 9999px;
          line-height: 1.25;
          border: 1px solid var(--line);
          background: var(--surface);
          color: var(--ink);
          white-space: nowrap;
        }
        .badge-success {
          background: #e6f4ea;
          color: #137333;
          border-color: #ceead6;
        }
        .badge-info {
          background: #e8f0fe;
          color: #1a73e8;
          border-color: #d2e3fc;
        }
        .badge-warning {
          background: #fef7e0;
          color: #b06000;
          border-color: #fce8b2;
        }
        .badge-muted {
          background: #f1f3f4;
          color: #5f6368;
          border-color: #dadce0;
        }
        @media (max-width: 64rem) {
          .workspace-tab-nav {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
          }
          .workspace-layout {
            grid-template-columns: minmax(0, 1fr);
          }
          .workspace-panel[data-mobile-active="false"] {
            display: none !important;
          }
          .workspace-panel[data-mobile-active="true"] {
            display: grid !important;
          }
          .workspace-reader-panel[data-mobile-active="false"] {
            display: none !important;
          }
          .workspace-reader-panel[data-mobile-active="true"] {
            display: grid !important;
          }
        }
        @media (min-width: 64.01rem) {
          .workspace-panel {
            display: grid !important;
          }
          .workspace-reader-panel {
            display: grid !important;
          }
        }
      `}</style>

      <div className="workspace-layout-root">
        {/* Mobile/Narrow Screen Accessible Tab Switcher */}
        <nav className="workspace-tab-nav" aria-label="Workspace views" role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-assistant"
            aria-controls="panel-assistant"
            aria-selected={activeTab === 'assistant'}
            className={`workspace-tab-btn ${activeTab === 'assistant' ? 'active' : ''}`}
            onClick={() => setActiveTab('assistant')}
          >
            Assistant
          </button>
          <button
            type="button"
            role="tab"
            id="tab-sources"
            aria-controls="panel-sources"
            aria-selected={activeTab === 'sources'}
            className={`workspace-tab-btn ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            Sources
          </button>
          <button
            type="button"
            role="tab"
            id="tab-reader"
            aria-controls="panel-reader"
            aria-selected={activeTab === 'reader'}
            className={`workspace-tab-btn ${activeTab === 'reader' ? 'active' : ''}`}
            onClick={() => setActiveTab('reader')}
          >
            Reader
          </button>
        </nav>

        <div className="document-layout workspace-layout">
          {/* Main workspace area: Assistant and Sources */}
          <div className="workspace-main-area">
            {/* Assistant Panel */}
            <div
              id="panel-assistant"
              role="tabpanel"
              aria-labelledby="tab-assistant"
              className="workspace-panel"
              data-mobile-active={activeTab === 'assistant'}
            >
              <InteractionPanel
                workspaceId={workspace.workspace_id}
                documents={documents}
                canPublish={mayWrite}
                onCitation={(docId, targetPage) => select(docId, targetPage, true)}
              />
            </div>

            {/* Sources & Academic Library Panel */}
            <div
              id="panel-sources"
              role="tabpanel"
              aria-labelledby="tab-sources"
              className="workspace-panel"
              data-mobile-active={activeTab === 'sources'}
            >
              <section className="panel form-stack" aria-labelledby="documents-heading">
                <h2 id="documents-heading">Documents</h2>
                {mayWrite && (
                  <form className="form-stack" method="post" onSubmit={upload}>
                    <label>Document file
                      <input
                        type="file"
                        name="file"
                        accept=".pdf,.docx"
                        required
                        disabled={busy}
                        onChange={() => { uploadKey.current = null }}
                      />
                    </label>
                    <button type="submit" disabled={busy}>Upload document</button>
                  </form>
                )}
                {error && <p role="alert">{error}</p>}
                {!documents.length && <p className="muted">There are no documents in this workspace.</p>}
                <ul className="document-list">
                  {documents.map(document => {
                    const isSelected = document.document_id === selectedId
                    const jobs = documentJobs[document.document_id]
                    return (
                      <li
                        key={document.document_id}
                        className={`document-list-item ${isSelected ? 'selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="secondary document-select-btn"
                          aria-pressed={isSelected}
                          onClick={() => select(document.document_id, 1, true)}
                        >
                          {document.name}
                        </button>
                        <div className="document-badges">
                          {document.preview_ready ? (
                            <span className="badge badge-success">Preview ready</span>
                          ) : (
                            <span className="badge badge-muted">
                              {jobs?.preview === 'running'
                                ? 'Generating preview…'
                                : jobs?.preview === 'failed'
                                ? 'Preview failed'
                                : 'Preview queued'}
                            </span>
                          )}
                          {jobs?.index === 'succeeded' ? (
                            <span className="badge badge-success">Indexed</span>
                          ) : jobs?.index === 'running' ? (
                            <span className="badge badge-info">Indexing…</span>
                          ) : jobs?.index === 'failed' ? (
                            <span className="badge badge-warning">Index failed</span>
                          ) : (
                            <span className="badge badge-muted">Index queued</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {!!documents.length && (
                  <SourceSearch
                    workspaceId={workspace.workspace_id}
                    documents={documents}
                    onCitation={(docId, targetPage) => select(docId, targetPage, true)}
                  />
                )}
                <AcademicLibrary
                  workspace={workspace}
                  onCitation={(docId, targetPage) => select(docId, targetPage, true)}
                />
              </section>
            </div>
          </div>

          {/* Right-side Reader Panel: Document preview, page navigation, personal annotations */}
          <div
            id="panel-reader"
            role="tabpanel"
            aria-labelledby="tab-reader"
            className="workspace-panel workspace-reader-wrapper"
            data-mobile-active={activeTab === 'reader'}
          >
            <aside
              role="region"
              aria-label="Document preview"
              className="panel form-stack document-preview workspace-reader-panel"
            >
              {selectedDoc ? (
                <>
                  <h2>{selectedDoc.name}</h2>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => download(selectedDoc.document_id)}
                    >
                      Download original
                    </button>
                    {mayWrite && (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => remove(selectedDoc)}
                      >
                        Delete document
                      </button>
                    )}
                  </div>
                  {mayWrite && (
                    <form
                      className="inline-form"
                      method="post"
                      key={selectedDoc.document_id}
                      onSubmit={event => rename(event, selectedDoc.document_id)}
                    >
                      <label>
                        Document name
                        <input
                          name="name"
                          defaultValue={selectedDoc.name}
                          maxLength={200}
                          required
                        />
                      </label>
                      <button type="submit" disabled={busy}>Save name</button>
                    </form>
                  )}
                  {selectedDoc.preview_ready ? (
                    <AnnotatedPreview
                      key={selectedDoc.document_id}
                      documentUrl={base + '/' + selectedDoc.document_id}
                      page={page}
                      onPage={next => select(selectedDoc.document_id, next, false)}
                    />
                  ) : (
                    <p role="status">
                      {selectedPreviewJob === 'failed'
                        ? 'Preview could not be generated.'
                        : selectedPreviewJob === 'cancelled'
                        ? 'Preview was cancelled.'
                        : selectedPreviewJob === 'running'
                        ? 'Generating PDF preview…'
                        : selectedPreviewJob === 'succeeded'
                        ? 'Loading PDF preview…'
                        : 'PDF preview is queued.'}
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">Select a document to preview it.</p>
              )}
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}
