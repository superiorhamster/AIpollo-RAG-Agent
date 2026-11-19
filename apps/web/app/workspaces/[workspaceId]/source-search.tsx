'use client'

import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import type { DocumentItem } from './document-shelf'

type Evidence = {
  chunk_id: string
  document_id: string
  name: string
  page: number
  section: string
  text: string
}

type SearchResults = { evidence: Evidence[]; indexed_documents: string[] }

export function SourceSearch({ workspaceId, documents, onCitation }: {
  workspaceId: string
  documents: DocumentItem[]
  onCitation: (documentId: string, page: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SearchResults>()
  const visible = result?.evidence.filter(item => documents.some(doc => doc.document_id === item.document_id))

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const document_ids = data.getAll('source').map(String)
    if (!document_ids.length || document_ids.length > 100) {
      setError('Choose between 1 and 100 sources.')
      return
    }
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      setResult(await api<SearchResults>('/v1/workspaces/' + workspaceId + '/search', 'POST', {
        query: String(data.get('query')).trim(), document_ids,
      }))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-stack" aria-labelledby="source-search-heading">
      <h3 id="source-search-heading">Search sources</h3>
      <form className="form-stack" onSubmit={search}>
        <label>Search terms<input name="query" required minLength={2} maxLength={1800} disabled={busy} /></label>
        <fieldset disabled={busy}>
          <legend>Sources</legend>
          {documents.map(document => (
            <label className="check-option" key={document.document_id}>
              <input type="checkbox" name="source" value={document.document_id} /> {document.name}
            </label>
          ))}
        </fieldset>
        <button disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {visible && !visible.length && <p role="status">{
        result?.indexed_documents.length ? 'No matching passages.' : 'The selected sources are not indexed yet.'
      }</p>}
      {!!visible?.length && <ol className="form-stack">
        {visible.map(item => (
          <li key={item.chunk_id}>
            <button type="button" className="secondary" onClick={() => onCitation(item.document_id, item.page)}>
              {item.name}, page {item.page}
            </button>
            {item.section && <p><strong>{item.section}</strong></p>}
            <p className="source-excerpt">{item.text}</p>
          </li>
        ))}
      </ol>}
    </section>
  )
}
