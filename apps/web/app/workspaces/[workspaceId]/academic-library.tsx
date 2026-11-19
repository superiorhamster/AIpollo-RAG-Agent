'use client'

import { GeneratedContent } from './generated-content'
import { useState, type FormEvent } from 'react'
import { api, errorMessage, type Workspace } from '../../lib/api'

type Citation = { document_id: string; chunk_id: string; name: string; page: number }
type Artifact = { artifact_id: string; name: string; kind: string }
type ArtifactDetail = Artifact & { can_manage: boolean; body: { claims: { text: string; fields?: Record<string, string>; citations: Citation[] }[] } }
type Reference = { doi: string; title: string; authors: string[]; publication_year: number | null; tags: string[] }

export function AcademicLibrary({ workspace, onCitation }: {
  workspace: Workspace
  onCitation: (id: string, page: number) => void
}) {
  const base = '/v1/workspaces/' + workspace.workspace_id
  const canWrite = workspace.role !== 'VIEWER'
  const [artifacts, setArtifacts] = useState<Artifact[]>()
  const [opened, setOpened] = useState<ArtifactDetail>()
  const [references, setReferences] = useState<Reference[]>()
  const [matches, setMatches] = useState<Reference[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
    return <li key={item.doi} className="form-stack">
      <a href={'https://doi.org/' + encodeURIComponent(item.doi)} target="_blank" rel="noreferrer">{item.title}</a>
      <span>{[item.authors.join(', '), item.publication_year].filter(Boolean).join(' · ')}</span>
      {canWrite && <form className="inline-form" onSubmit={save}>
        <label>Tags<input name="tag" defaultValue={item.tags.join(', ')} maxLength={240} /></label>
        <button disabled={busy}>{saved ? 'Update tags' : 'Save reference'}</button>
      </form>}
      {saved && canWrite && <button className="secondary" disabled={busy} onClick={() => void request(async () => {
        await api(base + '/references/remove', 'POST', item)
        setReferences(await api<Reference[]>(base + '/references'))
      })}>Remove reference</button>}
    </li>
  }

  return <>
    <section className="form-stack" aria-labelledby="artifacts-heading">
      <h3 id="artifacts-heading">Shared artifacts</h3>
      <button type="button" className="secondary" disabled={busy}
        onClick={() => void request(async () => setArtifacts(await api<Artifact[]>(base + '/artifacts')))}>
        {artifacts ? 'Refresh artifacts' : 'Load artifacts'}
      </button>
      {artifacts && <ul>{artifacts.map(item => <li key={item.artifact_id}>
        <button type="button" className="secondary" disabled={busy}
          onClick={() => void request(async () => setOpened(await api<ArtifactDetail>(base + '/artifacts/' + item.artifact_id)))}>
          {item.name}
        </button>
      </li>)}</ul>}
      {opened && <article className="form-stack">
        <h4>{opened.name}</h4>
        {opened.body.claims.map((claim, i) => <div key={i}>
          <GeneratedContent text={claim.text} fields={claim.fields} kind={opened.kind} />
          {claim.citations.map(citation => <button type="button" className="secondary" key={citation.chunk_id}
            onClick={() => onCitation(citation.document_id, citation.page)}>
            {citation.name}, page {citation.page}
          </button>)}
        </div>)}
        <div className="actions">
          <a href={base + '/artifacts/' + opened.artifact_id + '/export/md'}>Download Markdown</a>
          <a href={base + '/artifacts/' + opened.artifact_id + '/export/docx'}>Download DOCX</a>
        </div>
        {opened.can_manage && <form className="inline-form" key={opened.artifact_id} onSubmit={event => {
          event.preventDefault()
          const name = String(new FormData(event.currentTarget).get('name')).trim()
          void request(async () => {
            const changed = await api<Artifact>(base + '/artifacts/' + opened.artifact_id, 'PATCH', { name })
            setOpened({ ...opened, name: changed.name })
            setArtifacts(items => items?.map(item => item.artifact_id === changed.artifact_id ? changed : item))
          })
        }}>
          <label>Artifact name<input name="name" defaultValue={opened.name} required maxLength={150} /></label>
          <button disabled={busy}>Rename artifact</button>
          <button type="button" className="danger" disabled={busy} onClick={() => {
            if (!window.confirm('Delete this artifact?')) return
            void request(async () => {
              await api(base + '/artifacts/' + opened.artifact_id, 'DELETE')
              setOpened(undefined)
              setArtifacts(items => items?.filter(item => item.artifact_id !== opened.artifact_id))
            })
          }}>Delete artifact</button>
        </form>}
      </article>}
    </section>
    <section className="form-stack" aria-labelledby="references-heading">
      <h3 id="references-heading">References</h3>
      <form className="inline-form" onSubmit={discover}>
        <label>Paper title or topic<input name="keyword" required maxLength={200} /></label>
        <button disabled={busy}>Find papers</button>
      </form>
      {!!matches?.length && <ol className="form-stack">{matches.map(item => renderReference(item, false))}</ol>}
      {matches?.length === 0 && <p>No matching papers.</p>}
      <div className="actions">
        <button type="button" className="secondary" disabled={busy}
          onClick={() => void request(async () => setReferences(await api<Reference[]>(base + '/references')))}>Saved references</button>
        <a href={base + '/references/export'}>Download BibTeX</a>
      </div>
      {!!references?.length && <ol className="form-stack">{references.map(item => renderReference(item, true))}</ol>}
    </section>
    {error && <p role="alert">{error}</p>}
  </>
}
