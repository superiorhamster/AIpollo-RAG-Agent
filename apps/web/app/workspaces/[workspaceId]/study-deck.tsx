'use client'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import type { CitationTarget } from './pdf-preview'

type Card = { card_id: string; front: string; back: string; version: number; due_at: string | null; citations: (CitationTarget & { name: string; chunk_id: string })[] }
export function StudyDeck({ base, artifactId, onCitation }: { base: string; artifactId: string; onCitation: (citation: Card['citations'][number]) => void }) {
  const { text } = useWorkspaceLanguage()
  const [cards, setCards] = useState<Card[]>()
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState<{ card: string; version: number; rating: number; key: string }>()
  useEffect(() => {
    let current = true
    setCards(undefined)
    setFlipped(false)
    setPending(undefined)
    void api<{ cards: Card[] }>(base + '/artifacts/' + artifactId + '/cards?due_only=true')
      .then(value => { if (current) { setCards(value.cards); setError('') } })
      .catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [base, artifactId, retry])
  const card = cards?.[0]
  async function rate(rating: number) {
    if (!card || busy || submitting.current || !flipped) return
    submitting.current = true
    const request = pending?.card === card.card_id ? pending : { card: card.card_id, version: card.version, rating, key: crypto.randomUUID() }
    setPending(request)
    setBusy(true)
    setError('')
    try {
      await api(base + '/artifacts/' + artifactId + '/cards/' + card.card_id + '/reviews', 'POST',
        { rating: request.rating, expected_version: request.version }, request.key)
      setCards(current => current?.filter(item => item.card_id !== request.card))
      setFlipped(false)
      setPending(undefined)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <section className="form-stack" aria-label={text('Personal review', 'Ôn tập cá nhân')}>
    <p>{text('Your review schedule is private. Due times use UTC.', 'Lịch ôn của bạn là riêng tư. Thời điểm đến hạn dùng UTC.')}</p>
    {error && <p role="alert">{error}</p>}
    {!cards && !error && <p role="status">{text('Loading due cards…', 'Đang tải thẻ đến hạn…')}</p>}
    {cards?.length === 0 && <p role="status">{text('No cards are due. Come back later.', 'Chưa có thẻ đến hạn. Hãy quay lại sau.')}</p>}
    {card && <article className="run-card form-stack">
      <h3>{card.front}</h3>
      <button type="button" className="secondary sm" disabled={busy} onClick={() => setFlipped(value => !value)}>{flipped ? text('Show front', 'Xem mặt trước') : text('Show back', 'Xem mặt sau')}</button>
      {flipped && <>
        <p>{card.back}</p>
        <div className="actions">{card.citations.map(citation => <button type="button" className="citation-pill" key={citation.chunk_id} onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}</div>
        <div className="actions" role="group" aria-label={text('Review rating', 'Đánh giá ôn tập')}>
          {(['Again', 'Hard', 'Good', 'Easy'] as const).map((label, index) => <button type="button" className="secondary sm" key={label}
            disabled={busy || (!!pending && pending.rating !== index + 1)} onClick={() => void rate(index + 1)}>{text(label, ['Quên', 'Khó', 'Nhớ', 'Dễ'][index])}</button>)}
        </div>
      </>}
    </article>}
    <button type="button" className="secondary sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>{text('Refresh due cards', 'Tải lại thẻ đến hạn')}</button>
  </section>
}
