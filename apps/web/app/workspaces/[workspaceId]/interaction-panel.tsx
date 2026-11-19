'use client'

import { GeneratedContent } from './generated-content'
import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import type { DocumentItem } from './document-shelf'

type Mode = 'ASK' | 'PLAN' | 'AGENT'
type Capability = 'LEARN' | 'RESEARCH' | 'WRITE'
const tasks: Record<Capability, Record<string, string>> = {
  LEARN: { answer: 'Answer', explanation: 'Explanation', study_guide: 'Study guide', quiz: 'Quiz',
    flashcards: 'Flashcards', mind_map: 'Mind map' },
  RESEARCH: { answer: 'Answer', comparison: 'Compare papers', screening: 'Screen papers',
    extraction: 'Extract findings', evidence_table: 'Evidence table', synthesis: 'Synthesis' },
  WRITE: { answer: 'Answer', draft: 'Draft', rewrite: 'Rewrite', summary: 'Summary', citation_review: 'Citation review' },
}
type Objective = { query: string; document_ids: string[]; capability: Capability; task: string }
type Plan = {
  plan_id: string
  plan_version: number
  state: 'REVIEW' | 'ACCEPTED' | 'CANCELLED'
  objective: Objective
  steps: { tool: string; action: string }[]
  expected_outputs: string[]
}
type Citation = { chunk_id: string; document_id: string; page: number; name: string }
type Result = { kind?: string; claims: { text: string; fields?: Record<string, string>; citations: Citation[] }[]; insufficient_evidence: boolean }
type Run = {
  run_id: string
  conversation_id: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  step: 'retrieve' | 'compose' | null
  result: Result | null
  error_code: string | null
  query?: string
}
type Conversation = { conversation_id: string; name: string }

export function InteractionPanel({ workspaceId, documents, canPublish, onCitation }: {
  workspaceId: string
  documents: DocumentItem[]
  canPublish: boolean
  onCitation: (documentId: string, page: number) => void
}) {
  const base = '/v1/workspaces/' + workspaceId
  const [capability, setCapability] = useState<Capability>('LEARN')
  const [published, setPublished] = useState<string>()
  const [mode, setMode] = useState<Mode>('ASK')
  const [plan, setPlan] = useState<Plan>()
  const [run, setRun] = useState<Run>()
  const [activeId, setActiveId] = useState<string>()
  const [conversation, setConversation] = useState<string>()
  const [history, setHistory] = useState<Run[]>([])
  const [available, setAvailable] = useState<Conversation[]>()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!activeId) return
    const events = new EventSource(base + '/runs/' + activeId + '/events')
    events.onerror = () => {
      void api<Run>(base + '/runs/' + activeId).then(current => {
        setRun(current)
        if (current.status !== 'queued' && current.status !== 'running') {
          events.close()
          setActiveId(undefined)
        }
      }).catch(failure => {
        events.close()
        setActiveId(undefined)
        setError(errorMessage(failure))
      })
    }
    events.onmessage = (event: MessageEvent<string>) => {
      const current = JSON.parse(event.data) as Run
      setRun(current)
      if (current.status !== 'queued' && current.status !== 'running') {
        events.close()
        setActiveId(undefined)
      }
    }
    return () => events.close()
  }, [activeId, base])

  async function perform(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  function begin(fresh: Run) {
    if (run?.conversation_id && run.conversation_id === fresh.conversation_id) {
      setHistory(prior => [...prior, run])
    }
    setRun(fresh)
    setConversation(fresh.conversation_id ?? undefined)
    setActiveId(fresh.run_id)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input: Objective = {
      query: String(form.get('query')).trim(),
      document_ids: form.getAll('source').map(String),
      capability,
      task: String(form.get('task')),
    }
    if (input.query.length < 2 || !input.document_ids.length || input.document_ids.length > 100) {
      setError('Enter a question and choose between 1 and 100 sources.')
      return
    }
    void perform(async () => {
      if (editing && plan) {
        setPlan(await api<Plan>(base + '/plans/' + plan.plan_id, 'PATCH', { ...input, expected_version: plan.plan_version }))
      } else if (mode === 'PLAN') {
        setPlan(await api<Plan>(base + '/plans', 'POST', input, crypto.randomUUID()))
      } else {
        const fresh = await api<Run>(base + '/runs', 'POST', {
          mode, objective: input, conversation_id: mode === 'ASK' ? conversation : undefined,
        }, crypto.randomUUID())
        begin({ ...fresh, query: input.query })
      }
      setEditing(false)
    })
  }

  function review(action: 'accept' | 'regenerate' | 'cancel' | 'run', selected: Plan) {
    void perform(async () => {
      if (action === 'run') {
        begin(await api<Run>(base + '/runs', 'POST', {
          mode: 'PLAN', plan_id: selected.plan_id, plan_version: selected.plan_version,
        }, crypto.randomUUID()))
      } else {
        const path = base + '/plans/' + selected.plan_id + '/' + action
        setPlan(await api<Plan>(path, 'POST', { plan_version: selected.plan_version }, crypto.randomUUID()))
      }
    })
  }

  function answers(item: Run) {
    const label = item.status === 'running'
      ? item.step === 'compose' ? 'Writing answer…' : 'Searching selected sources…'
      : item.status === 'queued' ? 'Run queued.' : item.status === 'cancelled' ? 'Run cancelled.' : null
    return (
      <article key={item.run_id} className="form-stack">
        {item.query && <p><strong>{item.query}</strong></p>}
        {label && <p role="status">{label}</p>}
        {item.error_code && <p role="alert">Run failed. {item.error_code.replaceAll('_', ' ')}.</p>}
        {item.result?.insufficient_evidence && <p>The selected sources do not contain enough evidence to answer.</p>}
        {canPublish && !!item.result?.claims.length && <form className="inline-form" onSubmit={event => {
          event.preventDefault()
          const name = String(new FormData(event.currentTarget).get('name')).trim()
          void perform(async () => {
            await api(base + '/artifacts', 'POST', { name, run_id: item.run_id })
            setPublished(item.run_id)
          })
        }}>
          <label>Shared artifact name<input name="name" required maxLength={150} defaultValue={item.query?.slice(0, 150)} /></label>
          <button disabled={busy || published === item.run_id}>{published === item.run_id ? 'Saved' : 'Save as artifact'}</button>
        </form>}
        {item.result?.claims.map((claim, index) => <div key={index}>
          <GeneratedContent text={claim.text} fields={claim.fields} kind={item.result?.kind} />
          <div className="actions">
            {claim.citations.filter(citation => documents.some(doc => doc.document_id === citation.document_id))
              .map(citation => (
                <button type="button" className="secondary" key={citation.chunk_id}
                  onClick={() => onCitation(citation.document_id, citation.page)}>
                  {citation.name}, page {citation.page}
                </button>
            ))}
          </div>
        </div>)}
      </article>
    )
  }

  return (
    <section className="form-stack" aria-labelledby="workspace-interaction-heading">
      <h3 id="workspace-interaction-heading">Workspace assistant</h3>
      <div className="actions">
        <button type="button" className="secondary" disabled={busy || activeId !== undefined}
          onClick={() => void perform(async () => setAvailable(await api<Conversation[]>(base + '/conversations')))}>
          Chat history
        </button>
        {conversation && <button type="button" className="secondary" disabled={busy || activeId !== undefined}
          onClick={() => { setConversation(undefined); setRun(undefined); setHistory([]) }}>New chat</button>}
      </div>
      {available && <ul>
        {available.map(item => <li key={item.conversation_id}>
          <button type="button" className="secondary" disabled={busy || activeId !== undefined}
            onClick={() => void perform(async () => {
              setHistory(await api<Run[]>(base + '/conversations/' + item.conversation_id))
              setConversation(item.conversation_id)
              setRun(undefined)
              setMode('ASK')
              setAvailable(undefined)
            })}>{item.name}</button>
        </li>)}
      </ul>}
      <form className="form-stack" onSubmit={submit} key={editing ? plan?.plan_version : 'new'}>
        <label>Mode<select value={editing ? 'PLAN' : mode} disabled={editing || busy || activeId !== undefined}
          onChange={event => setMode(event.currentTarget.value as Mode)}>
          <option value="ASK">Ask</option><option value="PLAN">Plan</option><option value="AGENT">Agent</option>
        </select></label>
        <label>Capability<select value={capability} onChange={event => setCapability(event.currentTarget.value as Capability)}>
          <option value="LEARN">Learn</option><option value="RESEARCH">Research</option><option value="WRITE">Write</option>
        </select></label>
        <label>Output<select name="task" key={capability}
          defaultValue={editing && plan?.objective.capability === capability ? plan.objective.task : 'answer'}>
          {Object.entries(tasks[capability]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Question or objective<textarea name="query" minLength={2} maxLength={1800} required
          defaultValue={editing ? plan?.objective.query : ''} /></label>
        <fieldset><legend>Assistant sources</legend>
          {documents.map(doc => <label className="check-option" key={doc.document_id}>
            <input type="checkbox" name="source" value={doc.document_id}
              defaultChecked={editing && plan?.objective.document_ids.includes(doc.document_id)} /> {doc.name}
          </label>)}
        </fieldset>
        <button disabled={busy || activeId !== undefined}>{editing ? 'Save new version' : mode === 'PLAN' ? 'Create plan' : 'Send'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {plan && <article className="form-stack">
        <h4>Plan version {plan.plan_version}</h4>
        <p>{plan.objective.query}</p>
        <ol>{plan.steps.map(step => <li key={step.tool}>{step.action}</li>)}</ol>
        <p>{plan.expected_outputs.join(', ')}</p>
        <p>Selected sources</p>
        <ul>{plan.objective.document_ids.map(id => <li key={id}>
          {documents.find(doc => doc.document_id === id)?.name ?? 'Unavailable source'}
        </li>)}</ul>
        {plan.state === 'CANCELLED' && <p>Plan cancelled.</p>}
        {plan.state !== 'CANCELLED' && <div className="actions">
          {plan.state === 'REVIEW' && <button type="button" disabled={busy}
            onClick={() => review('accept', plan)}>Accept</button>}
          {plan.state === 'ACCEPTED' && <button type="button" disabled={busy || activeId !== undefined}
            onClick={() => review('run', plan)}>Run accepted plan</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => { setCapability(plan.objective.capability); setEditing(true) }}>Edit</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => review('regenerate', plan)}>Regenerate</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => review('cancel', plan)}>Cancel plan</button>
        </div>}
      </article>}
      {history.map(answers)}
      {run && answers(run)}
      {activeId && <button type="button" className="secondary" disabled={busy} onClick={() => void perform(async () => {
        setRun(await api<Run>(base + '/runs/' + activeId + '/cancel', 'POST'))
        setActiveId(undefined)
      })}>Cancel run</button>}
    </section>
  )
}
