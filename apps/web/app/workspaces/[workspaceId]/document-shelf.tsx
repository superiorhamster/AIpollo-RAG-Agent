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
  const [previewStatus, setPreviewStatus] = useState<{ id: string; status: Job['status'] | 'unavailable' }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const uploadKey = useRef<string | null>(null)
  const mayWrite = workspace.role !== 'VIEWER'
  const selectedDoc = documents.find(item => item.document_id === selectedId)
  const documentId = selectedDoc?.document_id
  const previewReady = selectedDoc?.preview_ready ?? false
  const base = `/v1/workspaces/${workspace.workspace_id}/documents`

  useEffect(() => {
    if (!documentId || previewReady) return
    const id = documentId
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      let terminal = false
      try {
        const [document, jobs] = await Promise.all([
          api<DocumentItem>(`${base}/${id}`), api<Job[]>(`${base}/${id}/jobs`),
        ])
        if (!active) return
        setDocuments(current => current.map(item => item.document_id === id ? document : item))
        const status = jobs.find(job => job.kind === 'preview')?.status ?? 'queued'
        setPreviewStatus({ id, status })
        terminal = document.preview_ready || status === 'failed' || status === 'cancelled'
      } catch (failure) {
        if (!active) return
        if (failure instanceof ApiError && failure.status === 401) {
          router.replace('/sign-in')
          return
        }
        terminal = failure instanceof ApiError && failure.status === 404
        setPreviewStatus({ id, status: 'unavailable' })
      }
      if (active && !terminal) timer = setTimeout(read, 1500)
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [base, documentId, previewReady, router])

  function select(id: string | undefined, nextPage = 1) {
    setSelectedId(id)
    setPage(nextPage)
    window.history.replaceState(null, '', workspaceLocation(workspace.workspace_id, id, nextPage))
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
      select(document.document_id)
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
      select(remaining[0]?.document_id)
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

  return (
    <div className="document-layout">
      <section className="panel form-stack" aria-labelledby="documents-heading">
        <h2 id="documents-heading">Documents</h2>
        {mayWrite && (
          <form className="form-stack" method="post" onSubmit={upload}>
            <label>Document file
              <input type="file" name="file" accept=".pdf,.docx" required disabled={busy}
                onChange={() => { uploadKey.current = null }} />
            </label>
            <button type="submit" disabled={busy}>Upload document</button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        {!documents.length && <p className="muted">There are no documents in this workspace.</p>}
        <ul className="document-list">
          {documents.map(document => (
            <li key={document.document_id}>
              <button type="button" className="secondary" aria-pressed={document.document_id === selectedId}
                onClick={() => select(document.document_id)}>
                {document.name}
              </button>
            </li>
          ))}
        </ul>
        {!!documents.length && (
          <>
            <InteractionPanel workspaceId={workspace.workspace_id} documents={documents} canPublish={mayWrite} onCitation={select} />
            <SourceSearch workspaceId={workspace.workspace_id} documents={documents} onCitation={select} />
          </>
        )}
        <AcademicLibrary workspace={workspace} onCitation={select} />
      </section>
      <aside className="panel form-stack document-preview" aria-label="Document preview">
        {selectedDoc ? (
          <>
            <h2>{selectedDoc.name}</h2>
            <div className="actions">
              <button type="button" className="secondary" disabled={busy}
                onClick={() => download(selectedDoc.document_id)}>Download original</button>
              {mayWrite && <button type="button" className="danger" disabled={busy}
                onClick={() => remove(selectedDoc)}>Delete document</button>}
            </div>
            {mayWrite && (
              <form className="inline-form" method="post" key={selectedDoc.document_id}
                onSubmit={event => rename(event, selectedDoc.document_id)}>
                <label>Document name<input name="name" defaultValue={selectedDoc.name} maxLength={200} required /></label>
                <button type="submit" disabled={busy}>Save name</button>
              </form>
            )}
            {selectedDoc.preview_ready
              ? <AnnotatedPreview key={selectedDoc.document_id} documentUrl={base + '/' + selectedDoc.document_id}
                  page={page} onPage={next => select(selectedDoc.document_id, next)} />
              : <p role="status">{
                previewStatus?.id === selectedDoc.document_id && {
                  failed: 'Preview could not be generated.', cancelled: 'Preview was cancelled.',
                  unavailable: 'Preview status is currently unavailable.', running: 'Generating PDF preview…',
                  queued: 'PDF preview is queued.', succeeded: 'Loading PDF preview…',
                }[previewStatus.status] || 'PDF preview is queued.'
              }</p>}
          </>
        ) : <p className="muted">Select a document to preview it.</p>}
      </aside>
    </div>
  )
}
