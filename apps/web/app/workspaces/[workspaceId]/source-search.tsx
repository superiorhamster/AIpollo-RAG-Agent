'use client'

import { useState, type FormEvent } from 'react'
import { Search, FileText, Layers, AlertCircle } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import type { CitationTarget } from './pdf-preview'
import type { DocumentItem } from './document-shelf'

type Evidence = CitationTarget & {
  chunk_id: string
  name: string
  section: string
  text: string
}

type SearchResults = { evidence: Evidence[]; indexed_documents: string[] }

export function SourceSearch({ workspaceId, documents, onCitation }: {
  workspaceId: string
  documents: DocumentItem[]
  onCitation: (target: CitationTarget) => void
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
    <section className="form-stack" aria-labelledby="source-search-heading" style={{ marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <Search size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: 'var(--accent)' }} />
        <h3 id="source-search-heading" style={{ margin: 0, fontSize: '1.05rem' }}>Search sources</h3>
      </div>
      <form className="form-stack" onSubmit={search}>
        <label>
          Search terms
          <input
            name="query"
            required
            minLength={2}
            maxLength={1800}
            disabled={busy}
            placeholder="Search passages across indexed sources..."
          />
        </label>
        <fieldset disabled={busy} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
          <legend style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--ink-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Layers size={13} aria-hidden="true" />
            <span>Sources</span>
          </legend>
          <div style={{ display: 'grid', gap: '0.35rem', maxHeight: '10rem', overflowY: 'auto' }}>
            {documents.map(document => (
              <label className="check-option" key={document.document_id}>
                <input type="checkbox" name="source" value={document.document_id} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FileText size={13} aria-hidden="true" style={{ color: 'var(--muted)' }} />
                  <span>{document.name}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifySelf: 'start' }}>
          <Search size={14} aria-hidden="true" />
          <span>{busy ? 'Searching…' : 'Search'}</span>
        </button>
      </form>

      {error && (
        <p role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {visible && !visible.length && (
        <p role="status">
          {result?.indexed_documents.length ? 'No matching passages.' : 'The selected sources are not indexed yet.'}
        </p>
      )}

      {!!visible?.length && (
        <ol className="form-stack" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {visible.map(item => (
            <li key={item.chunk_id} style={{ padding: '0.85rem', background: 'var(--surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
              <button
                type="button"
                className="secondary citation-pill"
                onClick={() => onCitation(item)}
                style={{ marginBottom: '0.5rem' }}
              >
                <FileText size={12} aria-hidden="true" />
                <span>{item.name}, page {item.page}</span>
              </button>
              {item.section && <p style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink-heading)', margin: '0 0 0.35rem 0' }}>{item.section}</p>}
              <p className="source-excerpt" style={{ margin: 0 }}>{item.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
