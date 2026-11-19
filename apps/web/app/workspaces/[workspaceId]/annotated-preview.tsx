'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { DesignIcon } from '../../components/aipollo'
import { api, errorMessage } from '../../lib/api'
import { PdfPreview, type CitationTarget, type Region } from './pdf-preview'

type Annotation = {
  annotation_id: string
  body: string
  page: number
  region: Region | null
}

export function AnnotatedPreview({ documentUrl, page, citation, onPage }: {
  documentUrl: string
  page: number
  citation?: CitationTarget
  onPage: (page: number) => void
}) {
  const [items, setItems] = useState<Annotation[]>([])
  const [selecting, setSelecting] = useState(false)
  const [draft, setDraft] = useState<{ page: number; region: Region }>()
  const [error, setError] = useState('')
  const path = documentUrl + '/annotations'
  const current = items.filter(item => item.page === page)
  const selection = draft?.page === page ? draft.region : undefined
  const regions = current.flatMap(item => item.region ? [item.region] : [])
  if (selection) regions.push(selection)

  useEffect(() => {
    let active = true
    void api<Annotation[]>(path).then(rows => { if (active) setItems(rows) }).catch(failure => {
      if (active) setError(errorMessage(failure))
    })
    return () => { active = false }
  }, [path])

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const body = String(new FormData(form).get('body')).trim()
    if (!body && !selection) return
    try {
      const item = await api<Annotation>(path, 'POST', { page, body, region: selection })
      setItems(rows => [...rows, item])
      setDraft(undefined)
      setError('')
      form.reset()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return <>
    <PdfPreview url={documentUrl + '/preview'} page={page} onPage={onPage} regions={regions} citationRegion={citation?.region ?? undefined}
      onRegion={selecting ? (region, selectedPage) => {
        setDraft({ page: selectedPage, region })
        setSelecting(false)
      } : undefined} />
    {citation?.text && <section className="reader-annotations form-stack" aria-label="Selected evidence">
      <h3><DesignIcon name="annotate" /> Source evidence · p. {citation.page}</h3>
      <p className="muted">{citation.text}</p>
    </section>}
    <section className="reader-annotations form-stack" aria-label="Personal annotations">
      <header>
        <h3><DesignIcon name="annotate" /> New annotation · p. {page}</h3>
        {selection && <span className="badge badge-info">Linked to passage</span>}
      </header>
      {selecting && <p role="status">Drag across a region on the PDF page.</p>}
      <form className="form-stack" onSubmit={add}>
        <textarea id="annotation-body" aria-label="Personal note" name="body" maxLength={3000}
          placeholder="Write a note linked to this page…" rows={2} />
        <div className="actions">
          <button className="sm">Save note or highlight</button>
          <button type="button" className="secondary sm" aria-pressed={selecting} onClick={() => setSelecting(active => !active)}>
            {selecting ? 'Cancel selection' : 'Select highlight'}
          </button>
          {selection && <button type="button" className="secondary sm" onClick={() => setDraft(undefined)}>Clear selection</button>}
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {!!current.length && <ul className="form-stack">
        {current.map(item => <li key={item.annotation_id}>
          <p>{item.body || 'Highlight'}</p>
          <button type="button" className="secondary" onClick={() => {
            void api(path + '/' + item.annotation_id, 'DELETE').then(() => {
              setItems(rows => rows.filter(row => row.annotation_id !== item.annotation_id))
            }).catch(failure => setError(errorMessage(failure)))
          }}>Remove annotation</button>
        </li>)}
      </ul>}
    </section>
  </>
}
