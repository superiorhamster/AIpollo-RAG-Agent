'use client'

import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { learningPlanDays } from './learning-plan-days'

type Objective = { id: string; day: number; goal: string; activities: string[]; progress: string }
type PreviewValue = string | number | string[] | Objective | null
type Card = {
  kind: 'edit' | 'completion'
  status: 'pending' | 'accepted' | 'rejected' | 'invalidated'
  payload: {
    objective?: string
    reply?: string
    changes?: { field: string; goal?: string; day?: number; before: PreviewValue; after: PreviewValue }[]
    proposal: { title: string; days: number; objectives: Objective[] }
  }
}

function valueText(value: PreviewValue) {
  if (value === null) return 'None'
  if (Array.isArray(value)) return value.join(' → ')
  if (typeof value === 'object') {
    return ['Day ' + value.day, value.goal, value.progress, ...value.activities].join(' · ')
  }
  return String(value)
}

const fieldLabels: Record<string, string> = {
  title: 'Plan title', days: 'Duration', order: 'Objective order', objective: 'Learning objective',
  objective_added: 'Objective added', objective_removed: 'Objective removed', day: 'Day assignment',
  goal: 'Learning goal', activities: 'Suggested activities', progress: 'Progress',
}

function PreviewContent({ value }: { value: PreviewValue }) {
  if (Array.isArray(value)) return <ol>{value.map((item, index) => <li key={index}>{item}</li>)}</ol>
  return <span>{valueText(value)}</span>
}

export function CreatedLearningPlan({ base, id, onOpen, refresh, visible }: {
  base: string; id: string; onOpen: (id: string) => void; refresh: number; visible: boolean
}) {
  const { text } = useWorkspaceLanguage()
  const [plan, setPlan] = useState<{ blueprint: Card['payload']['proposal'] }>()
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    if (!visible) return
    let current = true
    setPlan(undefined)
    setUnavailable(false)
    void api<{ blueprint: Card['payload']['proposal'] }>(base + '/learning-plans/' + id).then(value => {
      if (current) { setPlan(value); setUnavailable(false) }
    }).catch(() => { if (current) { setPlan(undefined); setUnavailable(true) } })
    return () => { current = false }
  }, [base, id, refresh, visible])
  return <section className="run-card form-stack learning-create-card" aria-label={text('Created Learning Plan', 'Kế hoạch học tập đã tạo')}>
    {unavailable ? <p>{text('The created Learning Plan is unavailable.', 'Kế hoạch học tập đã tạo hiện không khả dụng.')}</p> : plan ? <>
      <h3>{plan.blueprint.title}</h3>
      <p className="muted">{text(`${plan.blueprint.days} ${plan.blueprint.days === 1 ? 'day' : 'days'} · ${plan.blueprint.objectives.length} learning objectives`,
        `${plan.blueprint.days} ngày · ${plan.blueprint.objectives.length} mục tiêu học tập`)}</p>
      <div className="learning-create-preview" role="region" tabIndex={0}
        aria-label={text('Current Learning Plan preview', 'Xem trước kế hoạch học tập hiện tại')}>
        <h4>{text('Current Learning Plan preview', 'Xem trước kế hoạch học tập hiện tại')}</h4>
        {learningPlanDays(plan.blueprint.days, plan.blueprint.objectives).map(([day, objectives]) =>
          <div className="learning-preview-day" key={day}>
            <strong>{text(`Day ${day}`, `Ngày ${day}`)}</strong>
            {objectives.length > 0 ? <ul>{objectives.map(({ objective }) =>
              <li key={objective.id}>{objective.goal}</li>)}</ul> : <p>{text('No objectives', 'Chưa có mục tiêu')}</p>}
          </div>)}
      </div>
      <button type="button" className="secondary sm" onClick={() => onOpen(id)}>
        {text('Open Learning Plan', 'Mở kế hoạch học tập')}
      </button>
    </> : <p role="status">{text('Loading Learning Plan…', 'Đang tải kế hoạch học tập…')}</p>}
  </section>
}

export function LearningCard({ base, id, revisionSignal, onAccepted }: {
  base: string; id: string; revisionSignal?: string; onAccepted: () => void
}) {
  const path = base + '/learning-cards/' + id
  const [card, setCard] = useState<Card>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let current = true
    void api<Card>(path).then(value => { if (current) setCard(value) })
      .catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [path, revisionSignal])

  async function decide(outcome: 'accepted' | 'rejected') {
    setSaving(true)
    setError('')
    try {
      setCard(await api<Card>(path, 'PUT', { outcome }))
      if (outcome === 'accepted') onAccepted()
    } catch (failure) {
      setError(errorMessage(failure))
      try { setCard(await api<Card>(path)) } catch { /* Retain the original failure. */ }
    } finally {
      setSaving(false)
    }
  }

  return <section className="run-card form-stack" aria-label="Learning Plan suggestion">
    {error && <p role="alert">{error}</p>}
    {!card && !error && <p role="status">Loading Learning Plan suggestion…</p>}
    {card && <>
      <h3>{card.kind === 'edit' ? 'Change Preview' : 'Completion Suggestion'}</h3>
      {card.payload.reply && <p>{card.payload.reply}</p>}
      {card.kind === 'completion' && <p>Mark “{card.payload.objective}” as completed?</p>}
      {card.kind === 'edit' && <>
        {card.payload.changes?.length ? <ol>{card.payload.changes.map((change, index) => <li key={index}>
          {change.goal && <div>Day {change.day} · {change.goal}</div>}
          <strong>{fieldLabels[change.field] ?? change.field}</strong>
          <div>Before: <PreviewContent value={change.before} /></div>
          <div>After: <PreviewContent value={change.after} /></div>
        </li>)}</ol> : <p>No changes.</p>}
        <details><summary>Full proposed plan</summary>
          <h4>{card.payload.proposal.title}</h4>
          <ol>{card.payload.proposal.objectives.map(item => <li key={item.id}>{valueText(item)}</li>)}</ol>
        </details>
      </>}
      {card.status === 'pending' ? <div className="actions">
        <button type="button" disabled={saving} onClick={() => void decide('accepted')}>Accept</button>
        <button type="button" className="secondary" disabled={saving} onClick={() => void decide('rejected')}>Reject</button>
      </div> : <p role="status">{card.status === 'invalidated' ? 'This suggestion is no longer current.' : 'Suggestion ' + card.status + '.'}</p>}
    </>}
  </section>
}
