'use client'

import { DesignIcon } from '../../components/aipollo'
import type { CitationTarget } from './pdf-preview'
import { GeneratedContent } from './generated-content'
import { useEffect, useState, type FormEvent } from 'react'
import { Bookmark, Download, Trash2, Edit3, ExternalLink, FileText, RefreshCw, AlertCircle, Search } from 'lucide-react'
import { api, errorMessage, type Workspace } from '../../lib/api'

type Citation = CitationTarget & { chunk_id: string; name: string }
type Artifact = { artifact_id: string; name: string; kind: string }
type ArtifactDetail = Artifact & { can_manage: boolean; body: { claims: { text: string; fields?: Record<string, string>; citations: Citation[] }[] } }
type Reference = { doi: string; title: string; authors: string[]; publication_year: number | null; tags: string[] }

const artifactTypes = {
  study_guide: 'Study guide', quiz: 'Quiz', flashcards: 'Flashcards', evidence_table: 'Evidence Table', mind_map: 'Mind map',
}
const evidenceColumns = { source: 'Paper', method: 'Method', outcome: 'Outcome', limitations: 'Limitations' } as const

export function AcademicLibrary({ workspace, view, onCitation }: {
  workspace: Workspace
  view?: 'artifacts' | 'references'
  onCitation: (target: CitationTarget) => void
}) {
  const base = '/v1/workspaces/' + workspace.workspace_id
  const canWrite = workspace.role !== 'VIEWER'
  const [artifacts, setArtifacts] = useState<Artifact[]>()
  const [opened, setOpened] = useState<ArtifactDetail>()
  const [kind, setKind] = useState<keyof typeof artifactTypes>()
  const [activeCitation, setActiveCitation] = useState<string>()
  const [references, setReferences] = useState<Reference[]>()
  const [matches, setMatches] = useState<Reference[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (view !== 'artifacts') return
    let current = true
    void api<Artifact[]>(base + '/artifacts').then(items => {
      if (current) setArtifacts(items)
    }).catch(failure => {
      if (current) setError(errorMessage(failure))
    })
    return () => { current = false }
  }, [base, view])

  function cite(item: Citation) {
    setActiveCitation(item.chunk_id)
    onCitation(item)
  }
  const visibleArtifacts = artifacts?.filter(item => !kind || item.kind === kind)

  async function request(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await operation() }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = String(new FormData(event.currentTarget).get('keyword')).trim()
    if (query) void request(async () => setMatches(await api<Reference[]>(base + '/references/discover', 'POST', { query })))
  }

  function renderReference(item: Reference, saved: boolean) {
    async function save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const tags = String(new FormData(event.currentTarget).get('tag')).split(',').map(tag => tag.trim()).filter(Boolean)
      await request(async () => {
        await api(base + '/references', 'POST', { ...item, tags })
        setReferences(await api<Reference[]>(base + '/references'))
      })
    }
    return (
      <li key={item.doi} className="form-stack" style={{ padding: '0.85rem', background: 'var(--surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
        <a
          href={'https://doi.org/' + encodeURIComponent(item.doi)}
          target="_blank"
          rel="noreferrer"
          style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <span>{item.title}</span>
          <ExternalLink size={13} aria-hidden="true" />
        </a>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {[item.authors.join(', '), item.publication_year].filter(Boolean).join(' · ')}
        </span>
        {canWrite && (
          <form className="inline-form" onSubmit={save} style={{ marginTop: '0.35rem' }}>
            <label style={{ flex: '1 1 10rem' }}>
              Tags
              <input name="tag" defaultValue={item.tags.join(', ')} maxLength={240} placeholder="e.g. meta-analysis, fMRI" />
            </label>
            <button disabled={busy} className="sm">
              {saved ? 'Update tags' : 'Save reference'}
            </button>
          </form>
        )}
        {saved && canWrite && (
          <button
            className="secondary sm"
            disabled={busy}
            onClick={() => void request(async () => {
              await api(base + '/references/remove', 'POST', item)
              setReferences(await api<Reference[]>(base + '/references'))
            })}
            style={{ width: 'fit-content', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Trash2 size={13} aria-hidden="true" />
            <span>Remove reference</span>
          </button>
        )}
      </li>
    )
  }

  return (
    <>
      <section className="artifact-library form-stack" hidden={view !== 'artifacts'} aria-labelledby="artifacts-heading">
        <header className="aipollo-section-heading">
          <div><h1 id="artifacts-heading">{opened?.kind === 'evidence_table' ? 'Evidence Table' : 'Artifacts'}</h1>
            <p>{opened?.name ?? workspace.name}</p></div>
          {opened && <div className="actions">
            <a className="button secondary sm" href={base + '/artifacts/' + opened.artifact_id + '/export/md'}>Export Markdown</a>
            <a className="button secondary sm" href={base + '/artifacts/' + opened.artifact_id + '/export/docx'}>Export DOCX</a>
          </div>}
        </header>
        <div className="artifact-tabs library-filters" aria-label="Filter artifact types">
          <button type="button" aria-pressed={!kind} onClick={() => { setKind(undefined); setOpened(undefined) }}>All</button>
          {Object.entries(artifactTypes).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={kind === value} onClick={() => {
              setKind(value as keyof typeof artifactTypes)
              if (opened?.kind !== value) setOpened(undefined)
            }}>{label}</button>
          ))}
        </div>
        <details className="artifact-picker" open={!opened || undefined}>
        <summary>Saved artifacts</summary>
        <button
          type="button"
          className="secondary sm"
          disabled={busy}
          onClick={() => void request(async () => setArtifacts(await api<Artifact[]>(base + '/artifacts')))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', alignSelf: 'start' }}
        >
          <RefreshCw size={13} aria-hidden="true" />
          <span>{artifacts ? 'Refresh artifacts' : 'Load artifacts'}</span>
        </button>
        {visibleArtifacts && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
            {visibleArtifacts.map(item => (
              <li key={item.artifact_id}>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={busy}
                  onClick={() => void request(async () => {
                    setOpened(await api<ArtifactDetail>(base + '/artifacts/' + item.artifact_id))
                    setActiveCitation(undefined)
                  })}
                  style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <FileText size={13} aria-hidden="true" />
                  <span>{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {visibleArtifacts?.length === 0 && <p className="muted">No saved artifacts in this view.</p>}
        </details>
        {opened && (
          <article className="form-stack">
            {opened.kind === 'evidence_table' ? <>
              <div className="aipollo-table-scroll"><table className="aipollo-table evidence-table">
                <thead><tr>{Object.values(evidenceColumns).map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
                <tbody>{opened.body.claims.map((row, index) => (
                  <tr key={index}>{Object.keys(evidenceColumns).map(column => (
                    <td key={column}>
                      {row.fields?.[column] ?? <span className="badge badge-warning">Unavailable</span>}
                      {column === 'source' && <div className="claim-citations">{row.citations.map(citation => (
                        <button type="button" className="citation-pill" key={citation.chunk_id}
                          aria-pressed={activeCitation === citation.chunk_id} onClick={() => cite(citation)}>
                          <DesignIcon name="citation" />{citation.name}, page {citation.page}
                        </button>
                      ))}</div>}
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table></div>
              <p className="muted">Open a citation to inspect the evidence for its row in the reader.</p>
            </> : opened.body.claims.map((claim, i) => (
              <div key={i} style={{ display: 'grid', gap: '0.4rem' }}>
                <GeneratedContent text={claim.text} fields={claim.fields} kind={opened.kind} />
                <div className="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {claim.citations.map(citation => (
                    <button
                      type="button"
                      className="secondary citation-pill"
                      key={citation.chunk_id}
                      onClick={() => cite(citation)}
                    >
                      <FileText size={12} aria-hidden="true" />
                      <span>{citation.name}, page {citation.page}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {opened.can_manage && (
              <form
                className="inline-form"
                key={opened.artifact_id}
                onSubmit={event => {
                  event.preventDefault()
                  const name = String(new FormData(event.currentTarget).get('name')).trim()
                  void request(async () => {
                    const changed = await api<Artifact>(base + '/artifacts/' + opened.artifact_id, 'PATCH', { name })
                    setOpened({ ...opened, name: changed.name })
                    setArtifacts(items => items?.map(item => item.artifact_id === changed.artifact_id ? changed : item))
                  })
                }}
                style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--line)' }}
              >
                <label style={{ flex: '1 1 10rem' }}>
                  Artifact name
                  <input name="name" defaultValue={opened.name} required maxLength={150} />
                </label>
                <button disabled={busy} className="sm">Rename artifact</button>
                <button
                  type="button"
                  className="danger sm"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Delete this artifact?')) return
                    void request(async () => {
                      await api(base + '/artifacts/' + opened.artifact_id, 'DELETE')
                      setOpened(undefined)
                      setArtifacts(items => items?.filter(item => item.artifact_id !== opened.artifact_id))
                    })
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  <span>Delete artifact</span>
                </button>
              </form>
            )}
          </article>
        )}
      </section>

      <section className="artifact-library form-stack" hidden={view !== 'references'} aria-labelledby="references-heading">
        <header className="aipollo-section-heading"><div><h1 id="references-heading">References</h1>
          <p>{workspace.name}</p></div></header>
        <form className="inline-form" onSubmit={discover}>
          <label style={{ flex: '1 1 12rem' }}>
            Paper title or topic
            <input name="keyword" required maxLength={200} placeholder="e.g. attention mechanism, transformer" />
          </label>
          <button disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Search size={14} aria-hidden="true" />
            <span>Find papers</span>
          </button>
        </form>
        {!!matches?.length && <ol className="form-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{matches.map(item => renderReference(item, false))}</ol>}
        {matches?.length === 0 && <p className="muted">No matching papers.</p>}
        <div className="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className="secondary sm"
            disabled={busy}
            onClick={() => void request(async () => setReferences(await api<Reference[]>(base + '/references')))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Bookmark size={13} aria-hidden="true" />
            <span>Saved references</span>
          </button>
          <a
            href={base + '/references/export'}
            className="button secondary sm"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Download size={13} aria-hidden="true" />
            <span>Download BibTeX</span>
          </a>
        </div>
        {!!references?.length && <ol className="form-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{references.map(item => renderReference(item, true))}</ol>}
      </section>

      {error && (
        <p role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </>
  )
}
