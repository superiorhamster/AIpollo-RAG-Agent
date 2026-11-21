'use client'

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { RotateCw } from 'lucide-react'
import { DesignIcon } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { api, errorMessage } from '../../lib/api'
import type { DocumentItem } from './document-shelf'
import { GeneratedContent } from './generated-content'
import type { CitationTarget } from './pdf-preview'

type Mode = 'ASK' | 'PLAN' | 'AGENT'
const modes = [
  { value: 'ASK', label: 'Ask', vietnamese: 'Hỏi', viHint: 'Trò chuyện · hỏi đáp theo nguồn', icon: 'ask', hint: 'Chat · grounded Q&A · read-only' },
  { value: 'PLAN', label: 'Plan', vietnamese: 'Lập kế hoạch', viHint: 'Xem xét kế hoạch trước khi phê duyệt', icon: 'plan', hint: 'Review-only · nothing runs until you accept' },
  { value: 'AGENT', label: 'Agent', vietnamese: 'Agent', viHint: 'Thực thi có giới hạn · theo dõi tiến độ', icon: 'agent', hint: 'Bounded execution · step progress' },
] as const
type Capability = 'LEARN' | 'RESEARCH' | 'WRITE'
const tasks: Record<Capability, Record<string, string>> = {
  LEARN: {
    answer: 'Answer',
    explanation: 'Explanation',
    study_guide: 'Study guide',
    quiz: 'Quiz',
    flashcards: 'Flashcards',
    mind_map: 'Mind map',
  },
  RESEARCH: {
    answer: 'Answer',
    comparison: 'Compare papers',
    screening: 'Screen papers',
    extraction: 'Extract findings',
    evidence_table: 'Evidence table',
    synthesis: 'Synthesis',
  },
  WRITE: {
    answer: 'Answer',
    draft: 'Draft',
    rewrite: 'Rewrite',
    summary: 'Summary',
    citation_review: 'Citation review',
  },
}
type Objective = { query: string; document_ids: string[]; capability: Capability; task: string }
type Plan = {
  plan_id: string
  plan_version: number
  accepted_at: string | null
  state: 'REVIEW' | 'ACCEPTED' | 'CANCELLED'
  objective: Objective
  steps: { tool: string; action: string }[]
  expected_outputs: string[]
}
type Citation = CitationTarget & { chunk_id: string; name: string }
type Result = { kind?: string; claims: {
  text: string
  fields?: Record<string, string>
  citations: Citation[]
  source?: 'document' | 'conversation'
}[]; insufficient_evidence: boolean }
type Run = {
  run_id: string
  retry_of_run_id?: string | null
  conversation_id: string | null
  interaction: Mode
  plan_version: number | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  step: 'retrieve' | 'compose' | null
  result: Result | null
  error_code: string | null
  retryable?: boolean
  objective?: Objective | null
  query?: string
}
type Conversation = { conversation_id: string; name: string }

export function InteractionPanel({
  workspaceId, workspaceName, documents, readySources, onOpenArtifact, selectedSources, setSelectedSources, onSourcesLock, showHistory, canPublish, onCitation,
}: {
  workspaceId: string
  workspaceName: string
  documents: DocumentItem[]
  readySources: string[]
  onOpenArtifact: (id: string) => void
  selectedSources: string[]
  setSelectedSources: Dispatch<SetStateAction<string[]>>
  onSourcesLock: (locked: boolean) => void
  showHistory: boolean
  canPublish: boolean
  onCitation: (target: CitationTarget) => void
}) {
  const base = '/v1/workspaces/' + workspaceId
  const { text } = useWorkspaceLanguage()
  const [capability, setCapability] = useState<Capability>('LEARN')
  const [published, setPublished] = useState<string>()
  const [savedArtifacts, setSavedArtifacts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string>()
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
  const [retries, setRetries] = useState<Record<string, Run>>({})
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({})
  const [retryingId, setRetryingId] = useState<string>()
  const retryTarget = useRef<{ id: string; previous: Run } | null>(null)
  const retryRunIds = useRef(new Map<string, string>())
  const queryField = useRef<HTMLTextAreaElement>(null)
  const locked = busy || activeId !== undefined || retryingId !== undefined

  useEffect(() => onSourcesLock(locked), [locked, onSourcesLock])

  useEffect(() => {
    if (!showHistory) return
    let current = true
    void api<Conversation[]>(base + '/conversations')
      .then(items => { if (current) setAvailable(items) })
      .catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [base, showHistory])

  useEffect(() => {
    if (editing) queryField.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!activeId) return
    const target = retryTarget.current
    const events = new EventSource(base + '/runs/' + activeId + '/events')
    let listening = true
    function update(current: Run) {
      if (!listening) return
      if (target) {
        const id = target.id
        setRetries(prior => ({ ...prior, [id]: { ...current, query: current.query ?? target.previous.query } }))
      } else {
        setRun(prior => ({ ...current, query: current.query ?? prior?.query }))
      }
      if (current.status !== 'queued' && current.status !== 'running') {
        listening = false
        events.close()
        setActiveId(undefined)
        if (target) {
          retryTarget.current = null
          setRetryingId(undefined)
        }
      }
    }
    events.onerror = () => {
      void api<Run>(base + '/runs/' + activeId).then(update).catch(failure => {
        if (!listening) return
        events.close()
        setActiveId(undefined)
        if (target) {
          setRetries(prior => ({ ...prior, [target.id]: target.previous }))
          setRetryErrors(prior => ({ ...prior, [target.id]: errorMessage(failure) }))
          retryTarget.current = null
          setRetryingId(undefined)
        } else {
          setError(errorMessage(failure))
        }
      })
    }
    events.onmessage = (event: MessageEvent<string>) => update(JSON.parse(event.data) as Run)
    return () => {
      listening = false
      events.close()
    }
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

  function submitRun(mode: 'ASK' | 'AGENT', objective: Objective, conversationId?: string, retryOfRunId?: string) {
    return api<Run>(base + '/runs', 'POST', {
      mode, objective, conversation_id: mode === 'ASK' ? conversationId : undefined,
      retry_of_run_id: retryOfRunId,
    }, crypto.randomUUID())
  }

  async function retry(originalId: string, failed: Run) {
    if (locked || retryTarget.current || !failed.retryable || !failed.objective || !failed.conversation_id) return
    retryTarget.current = { id: originalId, previous: failed }
    setRetryingId(originalId)
    setRetryErrors(prior => ({ ...prior, [originalId]: '' }))
    try {
      const fresh = await submitRun('ASK', failed.objective, failed.conversation_id, failed.run_id)
      retryRunIds.current.set(fresh.run_id, originalId)
      setRetries(prior => ({ ...prior, [originalId]: { ...fresh, query: fresh.query ?? failed.query } }))
      if (fresh.status === 'queued' || fresh.status === 'running') {
        setActiveId(fresh.run_id)
        return
      }
    } catch (failure) {
      setRetryErrors(prior => ({ ...prior, [originalId]: errorMessage(failure) }))
    }
    retryTarget.current = null
    setRetryingId(undefined)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedSources.some(id => !readySources.includes(id))) {
      setError(text('Wait for the selected sources to finish indexing.', 'Vui lòng chờ các nguồn đã chọn lập chỉ mục xong.'))
      return
    }
    const element = event.currentTarget
    const form = new FormData(element)
    const document_ids = selectedSources.filter(id => documents.some(doc => doc.document_id === id))
    const input: Objective = {
      query: String(form.get('query')).trim(),
      document_ids,
      capability,
      task: String(form.get('task')),
    }
    if (input.query.length < 2 || !input.document_ids.length || input.document_ids.length > 100) {
      setError('Enter a question and choose between 1 and 100 sources.')
      return
    }
    void perform(async () => {
      if (editing && plan) {
        const revised = await api<Plan>(base + '/plans/' + plan.plan_id, 'PATCH', {
          ...input,
          expected_version: plan.plan_version,
        })
        setPlan(revised)
        setEditing(false)
      } else if (mode === 'PLAN') {
        const created = await api<Plan>(base + '/plans', 'POST', input, crypto.randomUUID())
        setPlan(created)
        if (queryField.current && queryField.current === element.elements.namedItem('query')) queryField.current.value = ''
      } else {
        const fresh = await submitRun(mode, input, conversation)
        begin({ ...fresh, query: input.query })
        if (queryField.current && queryField.current === element.elements.namedItem('query')) queryField.current.value = ''
      }
    })
  }

  function review(action: 'accept' | 'regenerate' | 'cancel' | 'run', selected: Plan) {
    void perform(async () => {
      if (action === 'run') {
        const fresh = await api<Run>(base + '/runs', 'POST', {
          mode: 'PLAN',
          plan_id: selected.plan_id,
          plan_version: selected.plan_version,
        }, crypto.randomUUID())
        begin({ ...fresh, query: fresh.query ?? selected.objective.query })
      } else {
        const path = base + '/plans/' + selected.plan_id + '/' + action
        const updated = await api<Plan>(path, 'POST', { plan_version: selected.plan_version }, crypto.randomUUID())
        setPlan(updated)
      }
    })
  }

  function cancelRun() {
    if (!activeId) return
    void perform(async () => {
      const stopped = await api<Run>(base + '/runs/' + activeId + '/cancel', 'POST')
      const target = retryTarget.current
      if (target) {
        setRetries(prior => ({ ...prior, [target.id]: { ...stopped, query: stopped.query ?? target.previous.query } }))
        retryTarget.current = null
        setRetryingId(undefined)
      } else {
        setRun(prior => ({ ...stopped, query: stopped.query ?? prior?.query }))
      }
      setActiveId(undefined)
    })
  }

  function openConversation(item: Conversation) {
    void perform(async () => {
      const turns = await api<Run[]>(base + '/conversations/' + item.conversation_id)
      const visibleIds = new Set(turns.map(turn => turn.run_id))
      setHistory(turns.filter(turn => {
        const originalId = retryRunIds.current.get(turn.run_id)
        return !originalId || !visibleIds.has(originalId)
      }))
      setConversation(item.conversation_id)
      setRun(undefined)
      setMode('ASK')
    })
  }

  function newChat() {
    setConversation(undefined)
    setRun(undefined)
    setHistory([])
    setPlan(undefined)
    setEditing(false)
    setMode('ASK')
  }

  function answers(original: Run) {
    const item = retries[original.run_id] ?? original
    const retryPending = retryingId === original.run_id
    const active = item.status === 'running' || item.status === 'queued'
    const composing = item.step === 'compose'
    const searching = item.step === 'retrieve'
    const stages = [
      { label: 'Search selected sources', done: composing, running: searching },
      { label: 'Compose grounded response', done: false, running: composing },
    ]
    return (
      <article key={original.run_id} className="aipollo-turn">
        {item.query && <p className="chat-query">{item.query}</p>}
        {active && <section className="run-card" aria-label="Execution progress">
          <header className="aipollo-section-heading">
            <h2>{item.status === 'queued' ? 'Run queued' : 'Run in progress'}
              <span className="badge badge-success">{item.status === 'running' ? 'Executing' : 'Queued'}</span>
            </h2>
            {activeId === item.run_id && <button type="button" className="danger sm" disabled={busy} onClick={cancelRun}>Cancel run</button>}
          </header>
          {item.plan_version && <p className="muted">Accepted plan v{item.plan_version} · Run {item.run_id.slice(0, 8)}</p>}
          <progress max={stages.length} value={stages.filter(step => step.done).length} aria-label="Completed steps" />
          <ol className="run-stages">
            {stages.map(step => <li key={step.label} data-running={step.running}>
              <DesignIcon name={step.done ? 'step-completed' : step.running ? 'step-running' : 'clock'} />
              <span>{step.label}</span>
              <span className={`badge badge-${step.done ? 'success' : step.running ? 'info' : 'neutral'}`}>
                {step.done ? 'Completed' : step.running ? 'Running' : 'Pending'}
              </span>
            </li>)}
          </ol>
        </section>}
        {item.status === 'cancelled' && <p role="status">Run cancelled.</p>}
        {(item.error_code || retryPending) && <div className="ask-run-error">
          <p role={retryPending ? 'status' : 'alert'}><DesignIcon name="error" /> {retryPending
            ? 'Retrying…' : item.error_code === 'invalid_model_output' ? text('The model returned an invalid answer. Try again.', 'Mô hình trả lời sai định dạng hoặc trích dẫn. Hãy thử lại.') : `Run failed. ${item.error_code?.replaceAll('_', ' ')}.`}</p>
          {(retryPending || (item.interaction === 'ASK' && item.retryable && item.objective && item.conversation_id)) &&
            <button type="button" className="secondary sm ask-retry" aria-label="Retry" title="Retry"
              aria-busy={retryPending} disabled={locked} onClick={() => void retry(original.run_id, item)}>
              <RotateCw aria-hidden="true" size={16} />
            </button>}
        </div>}
        {retryErrors[original.run_id] && item.error_code && <p role="alert">{retryErrors[original.run_id]}</p>}
        {item.result?.insufficient_evidence && <div className="approval-notice" role="status">
          <DesignIcon name="warning" /><div><strong>Not enough evidence in the selected sources</strong>
            <p>Choose more sources and try again.</p></div>
        </div>}
        {!!item.result?.claims.length && <div className="assistant-response">
          <div className="response-brand"><DesignIcon name="assistant" /> Super Agentic RAG</div>
          {item.result.claims.map((claim, index) => (
            <div key={index} className="claim-row">
              <div className="claim-copy"><GeneratedContent text={claim.text} fields={claim.fields} kind={item.result?.kind} /></div>
              {claim.source === 'conversation' ? <span className="badge badge-neutral">
                {text('From this chat', 'Từ cuộc trò chuyện này')}
              </span> : <div className="claim-citations">
                {claim.citations.filter(citation => documents.some(doc => doc.document_id === citation.document_id))
                  .map(citation => <button type="button" className="citation-pill" key={citation.chunk_id}
                    onClick={() => onCitation(citation)}>
                    <DesignIcon name="citation" /><span>{citation.name}, page {citation.page}</span>
                  </button>)}
              </div>}
            </div>
          ))}
          <div className="response-actions">
          <button type="button" className="secondary sm" onClick={() => {
            const content = item.result?.claims.map(claim => {
              const sources = claim.citations.map(citation => citation.name + ', page ' + citation.page).join('; ')
              return sources ? claim.text + ' (' + sources + ')' : claim.text
            }).join('\n\n') ?? ''
            void navigator.clipboard.writeText(content).then(() => setCopied(item.run_id))
              .catch(failure => setError(errorMessage(failure)))
          }}>{copied === item.run_id ? 'Copied' : 'Copy'}</button>
          {canPublish && item.result.claims.some(claim => claim.citations.length > 0) && <details className="save-response">
            <summary>{published === item.run_id ? 'Artifact saved' : 'Save as artifact'}</summary>
            {item.result.claims.some(claim => claim.source === 'conversation') &&
              <p>{text('Only document-supported claims are saved.', 'Chỉ lưu các nội dung có nguồn tài liệu.')}</p>}
            <form className="inline-form" onSubmit={event => {
              event.preventDefault()
              const name = String(new FormData(event.currentTarget).get('name')).trim()
              void perform(async () => {
                const saved = await api<{ artifact_id: string }>(base + '/artifacts', 'POST', { name, run_id: item.run_id })
                setSavedArtifacts(current => ({ ...current, [item.run_id]: saved.artifact_id }))
                setPublished(item.run_id)
              })
            }}>
              <label>Shared artifact name<input name="name" required maxLength={150}
                defaultValue={item.query?.slice(0, 150)} /></label>
              <button className="sm" disabled={busy || published === item.run_id}>Save artifact</button>
            </form>
          </details>}
          {savedArtifacts[item.run_id] && <button type="button" className="secondary sm"
            onClick={() => onOpenArtifact(savedArtifacts[item.run_id])}>{text('Open artifact', 'Mở sản phẩm')}</button>}
          </div>
        </div>}
      </article>
    )
  }

  const effectiveMode = editing ? 'PLAN' : activeId && run?.interaction === 'PLAN' ? 'AGENT' : mode
  const currentMode = modes.find(item => item.value === effectiveMode) ?? modes[0]
  const visiblePlan = effectiveMode === 'PLAN' || run?.status === 'cancelled' ? plan : undefined
  function editPlan(target: Plan) {
    setCapability(target.objective.capability)
    setSelectedSources(target.objective.document_ids.filter(id => documents.some(doc => doc.document_id === id)))
    setEditing(true)
  }

  return (
    <section className="aipollo-assistant" aria-label="Workspace assistant" data-mode={effectiveMode}>
      <header className="aipollo-section-heading">
        <div><h1>{showHistory ? text('History', 'Lịch sử') : workspaceName}</h1><p>{showHistory ? workspaceName : text(currentMode.hint, currentMode.viHint)}</p></div>
        {!showHistory && <div className="assistant-heading-badges">
          <span className="badge mode-badge"><DesignIcon name={currentMode.icon} /> {text(currentMode.label + ' mode', currentMode.vietnamese)}</span>
          <span className="badge badge-neutral"><DesignIcon name="paper-tab" /> {selectedSources.length} of {documents.length} sources</span>
        </div>}
      </header>
      {error && <p role="alert"><DesignIcon name="error" /> {error}</p>}

      {showHistory && <div className="conversation-picker form-stack">
        {available && (available.length ? <ul>{available.map(item => <li key={item.conversation_id}>
          <button type="button" className="secondary sm" disabled={locked} onClick={() => openConversation(item)}>
            <DesignIcon name="chats" /> {item.name}
          </button>
        </li>)}</ul> : <p className="muted">There are no saved chats yet.</p>)}
        {!available && !error && <p role="status">Loading chats…</p>}
      </div>}

      <div className="assistant-thread">
        {history.map(answers)}
        {visiblePlan && <>
          <p className="chat-query">{visiblePlan.objective.query}</p>
          <article className="review-plan">
            <header className="plan-heading">
              <h2 aria-label={`Plan version ${visiblePlan.plan_version}`}>{text('Proposed plan', 'Kế hoạch đề xuất')}</h2>
              <span className={`badge badge-${visiblePlan.state === 'ACCEPTED' ? 'success' : 'primary'}`}>
                {visiblePlan.state === 'REVIEW' ? 'Ready for review' : visiblePlan.state === 'ACCEPTED' ? 'Accepted' : 'Cancelled'}
              </span>
              <span className="badge badge-neutral">v{visiblePlan.plan_version}</span>
            </header>
            {visiblePlan.state !== 'CANCELLED' && <ol className="plan-lifecycle" aria-label="Plan lifecycle">
              {[
                ['REVIEW', 'Ready for review'],
                ['ACCEPTED', 'Accepted'],
              ].map(([state, label]) => (
                <li key={state} aria-current={visiblePlan.state === state ? 'step' : undefined}>{label}</li>
              ))}
            </ol>}
            <p className="plan-goal"><strong>GOAL</strong> {visiblePlan.objective.query}</p>
            <ol className="plan-steps">{visiblePlan.steps.map((step, index) => (
              <li key={index}>
                <span className="plan-step-number">{index + 1}</span>
                <span>{step.action}</span>
                <span className="badge badge-neutral">{step.tool}</span>
              </li>
            ))}</ol>
            <dl className="plan-details">
              <div><dt>Scope</dt><dd>{visiblePlan.objective.document_ids.map(id =>
                documents.find(doc => doc.document_id === id)?.name ?? 'Unavailable source').join(', ')}</dd></div>
              <div><dt>Outputs</dt><dd>{visiblePlan.expected_outputs.join(', ')}</dd></div>
              <div><dt>Approval</dt><dd>{visiblePlan.accepted_at
                ? new Date(visiblePlan.accepted_at).toLocaleString() : 'Required for this version'}</dd></div>
            </dl>
            {visiblePlan.state === 'CANCELLED' ? <p>Plan cancelled.</p> : <div className="plan-actions">
              <button type="button" className="secondary sm" disabled={locked} onClick={() => editPlan(visiblePlan)}>{text('Edit plan', 'Chỉnh sửa')}</button>
              <button type="button" className="secondary sm" disabled={locked} onClick={() => review('regenerate', visiblePlan)}>{text('Regenerate', 'Tạo lại')}</button>
              <button type="button" className="danger sm plan-cancel" disabled={locked} onClick={() => review('cancel', visiblePlan)}>{text('Cancel plan', 'Hủy kế hoạch')}</button>
              {visiblePlan.state === 'REVIEW'
                ? <button type="button" className="sm" disabled={locked} onClick={() => review('accept', visiblePlan)}>{text('Accept plan', 'Duyệt kế hoạch')}</button>
                : <button type="button" className="sm" disabled={locked} onClick={() => review('run', visiblePlan)}>{text('Run accepted plan', 'Chạy kế hoạch đã duyệt')}</button>}
            </div>}
          </article>
          {visiblePlan.state === 'REVIEW' && <p className="approval-notice">
            <DesignIcon name="approval-lock" /> No execution has started. Accept this exact version to enable execution. Editing creates a new version.
          </p>}
        </>}
        {run && answers(run)}
      </div>

      <form hidden={showHistory} className="assistant-composer" onSubmit={submit} key={editing ? `edit-${plan?.plan_version}` : 'new-form'}>
        <textarea ref={queryField} aria-label="Question or objective" name="query" minLength={2} maxLength={1800}
          required rows={2} disabled={locked} defaultValue={editing ? plan?.objective.query : ''}
          placeholder={editing ? text('Tell the agent how to adjust this plan…', 'Cho biết cần điều chỉnh kế hoạch thế nào…')
            : effectiveMode === 'PLAN' ? text('Describe the goal for your plan…', 'Mô tả mục tiêu của kế hoạch…') : text('Ask a question about your selected sources…', 'Đặt câu hỏi về các nguồn đã chọn…')} />
        <div className="composer-options">
          <div className="composer-modes" role="group" aria-label="Mode">
            {modes.map(item => <button key={item.value} type="button" disabled={editing || locked}
              aria-pressed={effectiveMode === item.value} onClick={() => setMode(item.value)}>{text(item.label, item.vietnamese)}</button>)}
          </div>
          <span className="badge badge-neutral composer-source-count"><DesignIcon name="source-count" /> {selectedSources.length} sources</span>
          <select aria-label="Capability" value={capability} disabled={locked}
            onChange={event => setCapability(event.currentTarget.value as Capability)}>
            <option value="LEARN">Learn</option><option value="RESEARCH">Research</option><option value="WRITE">Write</option>
          </select>
          <select aria-label="Output" name="task" key={capability} disabled={locked}
            defaultValue={editing && plan?.objective.capability === capability ? plan.objective.task : 'answer'}>
            {Object.entries(tasks[capability]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <details className="composer-mobile-sources">
            <summary>{text('Choose sources', 'Chọn nguồn')}</summary>
            {documents.map(doc => <label className="check-option" key={doc.document_id}>
              <input type="checkbox" checked={selectedSources.includes(doc.document_id)} disabled={locked || !readySources.includes(doc.document_id)}
                onChange={event => {
                  const checked = event.currentTarget.checked
                  setSelectedSources(current => checked ? [...new Set([...current, doc.document_id])]
                    : current.filter(id => id !== doc.document_id))
                }} /> {doc.name}
            </label>)}
          </details>
          {conversation && !editing && <button type="button" disabled={locked} className="ghost sm" onClick={newChat}>New chat</button>}
          {editing && <button type="button" disabled={locked} className="secondary sm"
            onClick={() => setEditing(false)}>Cancel editing</button>}
          <button type="submit" disabled={locked} className="composer-send"
            aria-label={editing ? 'Save new version' : mode === 'PLAN' ? 'Create plan' : 'Send'}>
            <DesignIcon name="send" />
          </button>
        </div>
      </form>
    </section>
  )
}
