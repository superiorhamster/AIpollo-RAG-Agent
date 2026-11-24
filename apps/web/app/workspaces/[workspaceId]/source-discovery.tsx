'use client'
import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useWorkspaceLanguage } from '../../components/workspace-language'

type Reference = { doi: string; title: string; authors: string[]; publication_year: number | null; tags: string[] }
export function SourceDiscovery({ base, query, canSave }: { base: string; query: string; canSave: boolean }) {
  const { text } = useWorkspaceLanguage()
  const [matches, setMatches] = useState<Reference[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<string[]>([])
  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = String(new FormData(event.currentTarget).get('query')).trim()
    if (!query || busy) return
    setBusy(true); setError('')
    try {
      const found = await api<Reference[]>(base + '/references/discover', 'POST', { query })
      setMatches([...new Map(found.map(item => [item.doi, item])).values()])
    }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  return <details className="run-card form-stack"><summary>{text('Find additional sources', 'Tìm nguồn bổ sung')}</summary>
    <form className="form-stack" onSubmit={event => void discover(event)}>
      <label>{text('Review the external search query', 'Duyệt truy vấn tìm kiếm bên ngoài')}
        <input name="query" defaultValue={query.slice(0, 200)} minLength={1} maxLength={200} required disabled={busy} />
      </label>
      <button type="submit" className="secondary sm" disabled={busy}>{text('Approve Crossref search', 'Duyệt tìm trên Crossref')}</button>
    </form>
    <p>{text('Import and index the full text before using a reference as evidence.', 'Nhập và lập chỉ mục toàn văn trước khi dùng tham khảo làm bằng chứng.')}</p>
    {error && <p role="alert">{error}</p>}
    {matches?.length === 0 && <p role="status">{text('No matching references found.', 'Không tìm thấy tham khảo phù hợp.')}</p>}
    <ul>{matches?.map(item => <li key={item.doi}><a href={'https://doi.org/' + encodeURIComponent(item.doi)} target="_blank" rel="noreferrer">{item.title}</a>
      <p>{item.doi} · {item.authors.join(', ')} · {item.publication_year}</p>
      {canSave && <button type="button" className="secondary sm" disabled={busy || saved.includes(item.doi)} onClick={() => {
        setBusy(true); setError('')
        void api(base + '/references', 'POST', item).then(() => setSaved(values => [...values, item.doi]))
          .catch(failure => setError(errorMessage(failure))).finally(() => setBusy(false))
      }}>{saved.includes(item.doi) ? text('Reference saved', 'Đã lưu tham khảo') : text('Save reference', 'Lưu tham khảo')}</button>}
    </li>)}</ul>
  </details>
}
