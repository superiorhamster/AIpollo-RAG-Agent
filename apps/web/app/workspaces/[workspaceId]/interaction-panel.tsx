'use client'

import { CreatedLearningPlan, LearningCard } from './learning-card'

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { RotateCw } from 'lucide-react'
import { DesignIcon } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { ApiError, api, errorMessage } from '../../lib/api'
import { identifier } from '../../lib/workspace-location'
import type { DocumentItem } from './document-shelf'
import { GeneratedContent } from './generated-content'
import { SourceDiscovery } from './source-discovery'
import type { CitationTarget } from './pdf-preview'

export type Mode = 'ASK' | 'PLAN' | 'AGENT'
const modes = [
  { value: 'ASK', label: 'Ask', vietnamese: 'Hỏi', viHint: 'Hỏi đáp và kế hoạch học tập', icon: 'ask', hint: 'Questions and learning plans' },
  { value: 'AGENT', label: 'Agent', vietnamese: 'Agent', viHint: 'Thực thi có giới hạn · theo dõi tiến độ', icon: 'agent', hint: 'Bounded execution · step progress' },
] as const
type Capability = 'LEARN' | 'RESEARCH' | 'WRITE'
const tasks: Record<Capability, Record<string, string>> = {
  LEARN: {
    socratic_tutor: 'Socratic tutor',
    answer: 'Answer',
    explanation: 'Explanation',
    study_guide: 'Study guide',
    quiz: 'Quiz',
    flashcards: 'Flashcards',
    mind_map: 'Mind map',
  },
  RESEARCH: {
    answer: 'Answer',
    mock_defense: 'Mock defense',
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
type Objective = { draft_document_id?: string; tutor_action?: 'guide' | 'hint' | 'solution'; query: string; document_ids: string[]; capability: Capability; task: string }
type PlanStep = { day?: number; citations?: Citation[]; step_id: string; tool: 'retrieve' | 'compose'; action: string; objective: Objective; expected_output: string }
type Plan = {
  plan_id: string
  plan_version: number
  accepted_at: string | null
  state: 'REVIEW' | 'ACCEPTED' | 'CANCELLED' | 'GENERATING' | 'FAILED'
  generation_status?: 'ready' | 'queued' | 'running' | 'failed'
  generation_error?: string | null
  curriculum_days?: number | null
  objective: Objective
  steps: ({ tool: string; action: string } & Partial<PlanStep>)[]
  expected_outputs: string[]
}
type CitationMode = 'segment' | 'chunk'
const citationModeKey = 'aipollo.ask.citation-mode'

type Citation = CitationTarget & { chunk_id: string; name: string }
type MatrixCell = { document_id: string; criterion: string; status: 'supported' | 'contradicted' | 'insufficient'; finding: string; citations: Citation[] }
type PlanSelection = { selected_plan_id: string | null; selection_revision: number; unavailable?: boolean }
type LearningAction = 'create' | 'edit'
const noSelection: PlanSelection = { selected_plan_id: null, selection_revision: 0 }
type Result = { learning_plan_id?: string; learning_reply?: string; learning_card?: string; source_state?: 'zero' | 'empty' | 'found'; unsupported_parts?: string[] | null; defense_review?: { assessment: string; assumption: string; feedback: string; target_citations: Citation[]; counter_citations: Citation[] } | null; verified_draft?: boolean | null; evidence_matrix?: MatrixCell[] | null; budget_exhausted?: string | null; tutor_question?: string | null; kind?: string; claims: {
  text: string
  fields?: Record<string, string>
  citations: Citation[]
  source?: 'document' | 'conversation' | 'plan' | 'general'
}[]; insufficient_evidence: boolean }
type Run = {
  run_id: string
  retry_of_run_id?: string | null
  conversation_id: string | null
  interaction: Mode
  plan_version: number | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  updated_at?: string
  step: 'retrieve' | 'compose' | null
  result: Result | null
  error_code: string | null
  retryable?: boolean
  objective?: Objective | null
  query?: string
}
type Conversation = { conversation_id: string; name: string }

export function InteractionPanel({
  workspaceId, workspaceName, accountId, documents, readySources, onOpenArtifact, onOpenLearningPlan, selectedSources, setSelectedSources, onSourcesLock, showHistory, canPublish, onCitation, requestedMode, onModeChange, learningPlansVisible, learningPlanSlot,
}: {
  workspaceId: string
  workspaceName: string
  accountId: string
  documents: DocumentItem[]
  readySources: string[]
  onOpenArtifact: (id: string) => void
  onOpenLearningPlan: (id: string) => void
  selectedSources: string[]
  setSelectedSources: Dispatch<SetStateAction<string[]>>
  onSourcesLock: (locked: boolean) => void
  showHistory: boolean
  canPublish: boolean
  onCitation: (target: CitationTarget) => void
  requestedMode?: { mode: 'ASK' | 'PLAN'; nonce: number }
  learningPlansVisible?: boolean
  learningPlanSlot: HTMLDivElement | null
  onModeChange?: (mode: Mode) => void
}) {
  const base = '/v1/workspaces/' + workspaceId
  const { text } = useWorkspaceLanguage()
  const [capability, setCapability] = useState<Capability>('LEARN')
  const [published, setPublished] = useState<string>()
  const [savedArtifacts, setSavedArtifacts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string>()
  const [mode, setMode] = useState<Mode>(requestedMode?.mode ?? 'ASK')
  const [citationMode, setCitationMode] = useState<CitationMode>('segment')
  const [plan, setPlan] = useState<Plan>()
  const [features, setFeatures] = useState({ learning_plans: false, custom_plan: false, socratic_tutor: false, curriculum: false, research: false, discovery: false, mock_defense: false })
  const [curriculumDays, setCurriculumDays] = useState(0)
  const [selectedTask, setSelectedTask] = useState('answer')
  useEffect(() => {
    let current = true
    void api<typeof features>(base + '/workflow-features').then(value => { if (current) setFeatures(value) })
      .catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [base])
  const [workflowDraft, setWorkflowDraft] = useState<PlanStep[]>()
  const [run, setRun] = useState<Run>()
  const [stepProgress, setStepProgress] = useState<{ step_id: string; position: number; status: string; result?: { answer?: Result } }[]>([])
  useEffect(() => {
    if (!run?.run_id || run.interaction !== 'PLAN') return
    let current = true
    void api<typeof stepProgress>(base + '/runs/' + run.run_id + '/steps')
      .then(rows => { if (current) setStepProgress(rows) })
      .catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [base, run?.run_id, run?.updated_at, run?.interaction])
  const [activeId, setActiveId] = useState<string>()
  const [conversation, setConversation] = useState<string>()
  const [restoringConversation, setRestoringConversation] = useState(false)
  const conversationKey = 'aipollo:conversation:' + accountId + ':' + workspaceId
  const [selection, setSelection] = useState<PlanSelection>()
  const [learningPlans, setLearningPlans] = useState<{ plan_id: string; blueprint: { title: string } }[]>([])
  const [showAllPlans, setShowAllPlans] = useState(false)
  const [learningAction, setLearningAction] = useState<LearningAction>()
  const [learningDays, setLearningDays] = useState(0)
  const [commandPrefix, setCommandPrefix] = useState<string>()
  const [selectingPlan, setSelectingPlan] = useState(false)
  const [selectionRefresh, setSelectionRefresh] = useState(0)
  useEffect(() => {
    if (!features.learning_plans || !learningPlansVisible) return
    let current = true
    setSelection(conversation ? undefined : noSelection)
    const refresh = [
      api<typeof learningPlans>(base + '/learning-plans'),
      conversation ? api<PlanSelection>(base + '/conversations/' + conversation + '/learning-plan') : Promise.resolve(noSelection),
    ] as const
    void Promise.all(refresh).then(([plans, selected]) => {
      if (current) {
        setLearningPlans(plans)
        setSelection(selected)
      }
    }).catch(failure => { if (current) setError(errorMessage(failure)) })
    return () => { current = false }
  }, [base, conversation, features.learning_plans, learningPlansVisible, run?.result?.learning_plan_id, selectionRefresh])
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
  const locked = busy || restoringConversation || activeId !== undefined || retryingId !== undefined
  useEffect(() => {
    if (!features.learning_plans) return
    let saved: string | null
    try { saved = sessionStorage.getItem(conversationKey) } catch { return }
    if (!saved || !identifier.test(saved)) return
    const id = saved
    let current = true
    setRestoringConversation(true)
    void api<Run[]>(base + '/conversations/' + id).then(turns => {
      if (!current) return
      setHistory(turns)
      setConversation(id)
    }).catch(failure => {
      if (!current) return
      if (failure instanceof ApiError && failure.status === 404) {
        try { sessionStorage.removeItem(conversationKey) } catch { /* Storage is optional. */ }
      } else {
        setError(errorMessage(failure))
      }
    }).finally(() => { if (current) setRestoringConversation(false) })
    return () => { current = false }
  }, [base, conversationKey, features.learning_plans])

  function rememberConversation(id?: string) {
    setConversation(id)
    if (!features.learning_plans) return
    try {
      if (id) sessionStorage.setItem(conversationKey, id)
      else sessionStorage.removeItem(conversationKey)
    } catch { /* This visit still works when storage is blocked. */ }
  }
  const lastModeNonce = useRef(requestedMode?.nonce ?? 0)
  useEffect(() => {
    if (!requestedMode || requestedMode.nonce === lastModeNonce.current) return
    lastModeNonce.current = requestedMode.nonce
    if (locked || editing) return
    setMode(requestedMode.mode)
  }, [requestedMode, locked, editing])
  useEffect(() => {
    if (!plan || plan.state !== 'GENERATING') return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    let delay = 1000
    async function refresh() {
      try {
        const updated = await api<Plan>(base + '/plans/' + plan!.plan_id)
        if (!current) return
        setPlan(updated)
        if (updated.state !== 'GENERATING') return
      } catch (failure) {
        if (!current) return
        setError(errorMessage(failure))
      }
      delay = Math.min(delay * 1.5, 5000)
      timer = setTimeout(() => void refresh(), delay)
    }
    timer = setTimeout(() => void refresh(), delay)
    return () => { current = false; clearTimeout(timer) }
  }, [base, plan?.plan_id, plan?.plan_version, plan?.state])

  useEffect(() => {
    try {
      if (window.localStorage.getItem(citationModeKey) === 'chunk') setCitationMode('chunk')
    } catch {
      // The control still works for this visit when browser storage is blocked.
    }
  }, [])

  function chooseCitationMode(value: CitationMode) {
    setCitationMode(value)
    try {
      window.localStorage.setItem(citationModeKey, value)
    } catch {
      // The current selection remains in memory.
    }
  }

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
    rememberConversation(fresh.conversation_id ?? undefined)
    setActiveId(fresh.run_id)
  }

  function submitRun(mode: 'ASK' | 'AGENT', objective: Objective, conversationId?: string, retryOfRunId?: string,
    learning?: { action?: LearningAction; days?: number; revision: number }) {
    return api<Run>(base + '/runs', 'POST', {
      mode, objective, conversation_id: mode === 'ASK' ? conversationId : undefined,
      retry_of_run_id: retryOfRunId,
      citation_mode: mode === 'ASK' && !retryOfRunId ? citationMode : undefined,
      learning_action: learning?.action,
      learning_days: learning?.days,
      selection_revision: learning?.revision,
    }, crypto.randomUUID())
  }

  async function chooseLearningPlan(planId: string | null) {
    if (!selection || selectingPlan) return
    const body = { selected_plan_id: planId, selection_revision: selection.selection_revision }
    setSelectingPlan(true)
    setError('')
    try {
      if (conversation) {
        setSelection(await api<PlanSelection>(base + '/conversations/' + conversation + '/learning-plan', 'PUT', body))
      } else {
        const created = await api<PlanSelection & { conversation_id: string }>(base + '/conversations', 'POST', body)
        rememberConversation(created.conversation_id)
        setSelection(created)
      }
    } catch (failure) {
      setError(errorMessage(failure))
      setSelectionRefresh(value => value + 1)
    } finally {
      setSelectingPlan(false)
    }
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
      task: String(form.get('task') ?? 'answer'),
      ...(form.get('task') === 'mock_defense' ? { draft_document_id: String(form.get('draft_document_id')) } : {}),
    }
    const learningAsk = features.learning_plans && mode === 'ASK' && input.capability === 'LEARN' && input.task === 'answer'
    if (learningAsk && (!selection || selectingPlan)) return
    const command = learningAsk ? input.query.match(/^\/(plan|edit-plan)(?:\s+|$)/i) : null
    const action = command ? (command[1].toLowerCase() === 'plan' ? 'create' : 'edit') : learningAsk ? learningAction : undefined
    if (command) input.query = input.query.slice(command[0].length).trim()
    if (action === 'edit' && !selection?.selected_plan_id) {
      setError('Select a Learning Plan to edit.')
      return
    }
    if (input.query.length < 2 || (!input.document_ids.length && !learningAsk) || input.document_ids.length > 100) {
      setError('Enter a question and choose between 1 and 100 sources.')
      return
    }
    if (mode !== 'ASK' && features.research && input.capability === 'RESEARCH'
      && ['comparison', 'evidence_table', 'synthesis'].includes(input.task)
      && (input.document_ids.length < 2 || input.document_ids.length > 5)) {
      setError(text('Choose 2–5 papers for in-depth comparison.', 'Chọn 2–5 bài báo để so sánh chuyên sâu.'))
      return
    }
    const curriculum_days = mode === 'PLAN' && features.curriculum && input.capability === 'LEARN'
      && input.task === 'study_guide' && curriculumDays > 0 ? curriculumDays : undefined
    void perform(async () => {
      if (editing && plan) {
        const revised = await api<Plan>(base + '/plans/' + plan.plan_id, 'PATCH', {
          ...input, curriculum_days,
          expected_version: plan.plan_version,
        })
        setPlan(revised)
        setEditing(false)
      } else if (mode === 'PLAN') {
        const created = await api<Plan>(base + '/plans', 'POST', { ...input, curriculum_days }, crypto.randomUUID())
        setPlan(created)
        if (queryField.current && queryField.current === element.elements.namedItem('query')) queryField.current.value = ''
      } else {
        const fresh = await submitRun(mode, input, conversation, undefined, learningAsk ? {
          action, days: action === 'create' ? learningDays || undefined : undefined,
          revision: selection?.selection_revision ?? 0,
        } : undefined)
        setLearningAction(undefined)
        setLearningDays(0)
        setCommandPrefix(undefined)
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
      rememberConversation(item.conversation_id)
      setRun(undefined)
      setMode('ASK')
      onModeChange?.('ASK')
    })
  }

  function newChat() {
    setLearningAction(undefined)
    setLearningDays(0)
    setCommandPrefix(undefined)
    rememberConversation()
    setRun(undefined)
    setHistory([])
    setPlan(undefined)
    setEditing(false)
    setMode('ASK')
    onModeChange?.('ASK')
  }

  function answers(original: Run) {
    const item = retries[original.run_id] ?? original
    const result = item.result
    const unsupported = result?.unsupported_parts ?? []
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
        {item.result?.defense_review && <section className="run-card form-stack" aria-label={text('Mock defense review', 'Nhận xét phản biện')}>
          <p><strong>{item.result.defense_review.assessment.replaceAll('_', ' ')}</strong></p>
          <p>{text('Assumption to defend', 'Giả định cần bảo vệ')}: {item.result.defense_review.assumption}</p>
          {!!item.result.defense_review.feedback && <p>{item.result.defense_review.feedback}</p>}
          <div>{text('Passage under review', 'Đoạn đang được phản biện')}: {item.result.defense_review.target_citations.map(citation => <button type="button" className="citation-pill" key={citation.chunk_id} onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}</div>
          {!!item.result.defense_review.counter_citations.length && <div>{text('Counter evidence', 'Bằng chứng đối chiếu')}: {item.result.defense_review.counter_citations.map(citation => <button type="button" className="citation-pill" key={citation.chunk_id} onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}</div>}
        </section>}
        {item.result?.verified_draft && !!item.result.claims.length && <p className="badge badge-success">{text('Draft evidence checked · review before saving', 'Đã kiểm tra bằng chứng · xem nháp trước khi lưu')}</p>}
        {item.result?.tutor_question && <p className="source-excerpt">{item.result.tutor_question}</p>}
        {item.result?.source_state === 'zero' && <p role="status">No sources selected.</p>}
        {item.result?.source_state === 'empty' && <p role="status">No relevant passages were retrieved from the selected sources.</p>}
        {item.result?.learning_reply && <p>{item.result.learning_reply}</p>}
        {item.result?.learning_plan_id && <CreatedLearningPlan key={item.result.learning_plan_id} base={base} id={item.result.learning_plan_id}
          onOpen={onOpenLearningPlan} refresh={selectionRefresh} visible={Boolean(learningPlansVisible || showHistory)} />}
        {item.result?.learning_card && <LearningCard base={base} id={item.result.learning_card}
          revisionSignal={run?.updated_at} onAccepted={() => setSelectionRefresh(value => value + 1)} />}
        {item.result?.kind === 'socratic_tutor' && <div className="actions">
          {(['hint', 'solution'] as const).map(action => <button key={action} type="button" className="secondary sm" disabled={locked}
            onClick={() => void perform(async () => {
              const objective: Objective = {
                query: action === 'hint' ? text('Give me a smaller hint for the previous question.', 'Cho tôi gợi ý nhỏ hơn cho câu hỏi trước.') : text('Explain the solution with sources.', 'Giải thích lời giải kèm nguồn.'),
                document_ids: item.objective?.document_ids ?? selectedSources,
                capability: 'LEARN', task: 'socratic_tutor', tutor_action: action,
              }
              begin({ ...await submitRun('ASK', objective, item.conversation_id ?? undefined), query: objective.query })
            })}>{action === 'hint' ? text('More hints', 'Gợi ý thêm') : text('Show solution', 'Xem lời giải')}</button>)}
        </div>}
        {item.status === 'cancelled' && <p role="status">Run cancelled.</p>}
        {(item.error_code || retryPending) && <div className="ask-run-error">
          <p role={retryPending ? 'status' : 'alert'}><DesignIcon name="error" /> {retryPending
            ? 'Retrying…' : item.error_code === 'invalid_model_output'
              ? text('The model returned an invalid answer. Try again.', 'Mô hình trả lời sai định dạng hoặc trích dẫn. Hãy thử lại.')
              : item.error_code === 'interaction_unavailable' && item.retryable
                ? text('The AI provider is currently unavailable. You can retry this question.', 'Dịch vụ AI hiện không khả dụng. Bạn có thể thử lại câu hỏi này.')
                : `Run failed. ${item.error_code?.replaceAll('_', ' ')}.`}</p>
          {(retryPending || (item.interaction === 'ASK' && item.retryable && item.objective && item.conversation_id)) &&
            <button type="button" className="secondary sm ask-retry" aria-label="Retry" title="Retry"
              aria-busy={retryPending} disabled={locked} onClick={() => void retry(original.run_id, item)}>
              <RotateCw aria-hidden="true" size={16} />
            </button>}
        </div>}
        {retryErrors[original.run_id] && item.error_code && <p role="alert">{retryErrors[original.run_id]}</p>}
        {item.result?.budget_exhausted && <p role="status">{text('The run reached its budget. Verified findings are shown; incomplete cells are marked.', 'Đã hết ngân sách lượt chạy. Các kết quả đã kiểm tra được giữ lại; ô còn thiếu được đánh dấu.')}</p>}
        {features.discovery && item.result && (item.result.insufficient_evidence || item.result.evidence_matrix?.some(cell => cell.status === 'insufficient')) &&
          <SourceDiscovery key={item.run_id} base={base} query={item.query ?? ''} canSave={canPublish} />}
        {item.result?.evidence_matrix && <div className="table-scroll" tabIndex={0} role="region" aria-label={text('Evidence matrix', 'Ma trận bằng chứng')}>
          <table><caption>{text('Evidence by paper and criterion', 'Bằng chứng theo bài báo và tiêu chí')}</caption>
            <thead><tr><th>{text('Paper', 'Bài báo')}</th><th>{text('Criterion', 'Tiêu chí')}</th><th>{text('Finding', 'Kết quả')}</th><th>{text('Status and sources', 'Trạng thái và nguồn')}</th></tr></thead>
            <tbody>{item.result.evidence_matrix.map(cell => <tr key={cell.document_id + ':' + cell.criterion}>
              <th scope="row">{documents.find(doc => doc.document_id === cell.document_id)?.name ?? text('Unavailable source', 'Nguồn không còn khả dụng')}</th>
              <td>{cell.criterion}</td><td>{cell.status === 'contradicted' && text('Refuted statement: ', 'Nhận định bị bác bỏ: ')}{cell.finding || text('Not enough evidence', 'Chưa đủ bằng chứng')}</td>
              <td>{cell.status}{cell.citations.map(citation => <button type="button" className="citation-pill" key={citation.chunk_id}
                onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {item.result?.insufficient_evidence && !item.result.unsupported_parts?.length && <div className="approval-notice" role="status">
          <DesignIcon name="warning" /><div><strong>Not enough evidence in the selected sources</strong>
            <p>Choose more sources and try again.</p></div>
        </div>}
        {result && (result.claims.length > 0 || unsupported.length > 0) && <div className="assistant-response">
          <div className="response-brand"><DesignIcon name="assistant" /> Super Agentic RAG</div>
          {result.claims.map((claim, index) => (
            <div key={index} className="claim-row">
              <div className="claim-copy"><GeneratedContent text={claim.text} fields={claim.fields} kind={item.result?.kind} /></div>
              {claim.source && claim.source !== 'document' ? <span className="badge badge-neutral">
                {claim.source === 'plan' ? text('From your Learning Plan', 'Từ kế hoạch học tập của bạn')
                  : claim.source === 'general' ? text('General guidance', 'Hướng dẫn chung')
                    : text('From this chat', 'Từ cuộc trò chuyện này')}
              </span> : <div className="claim-citations">
                {claim.citations.filter(citation => documents.some(doc => doc.document_id === citation.document_id))
                  .map(citation => <button type="button" className="citation-pill" key={citation.citation_id ?? citation.chunk_id}
                    data-citation-id={citation.citation_id ?? citation.chunk_id}
                    onClick={() => onCitation(citation)}>
                    <DesignIcon name="citation" /><span>{citation.name}, page {citation.page}</span>
                  </button>)}
              </div>}
            </div>
          ))}
          {unsupported.map((part, index) => <p key={index} className="assistant-evidence-gap">{part}</p>)}
          <div className="response-actions">
          <button type="button" className="secondary sm" onClick={() => {
            const claims = result.claims.map(claim => {
              const sources = claim.citations.map(citation => citation.name + ', page ' + citation.page).join('; ')
              return sources ? claim.text + ' (' + sources + ')' : claim.text
            })
            const content = [...claims, ...unsupported].join('\n\n')
            void navigator.clipboard.writeText(content).then(() => setCopied(item.run_id))
              .catch(failure => setError(errorMessage(failure)))
          }}>{copied === item.run_id ? 'Copied' : 'Copy'}</button>
          {canPublish && result.claims.some(claim => claim.citations.length > 0) && <details className="save-response">
            <summary>{published === item.run_id ? 'Artifact saved' : 'Save as artifact'}</summary>
            {(unsupported.length > 0 || result.claims.some(claim => claim.source && claim.source !== 'document')) &&
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
  const learningComposer = features.learning_plans && effectiveMode === 'ASK'
  const selectedPlanId = selection?.selected_plan_id ?? ''
  const visibleLearningPlans = showAllPlans ? learningPlans : learningPlans.filter((plan, index) =>
    index < 3 || plan.plan_id === selectedPlanId)
  const hiddenPlanCount = learningPlans.filter((plan, index) => index >= 3 && plan.plan_id !== selectedPlanId).length
  const commands = ['/plan', '/edit-plan'] as const
  function activateCommand(command: typeof commands[number]) {
    setLearningAction(command === '/plan' ? 'create' : 'edit')
    setLearningDays(0)
    setCommandPrefix(undefined)
    if (queryField.current) {
      queryField.current.value = queryField.current.value.replace(/^\/[a-z-]+\s*/i, '')
      queryField.current.focus()
    }
  }
  const visiblePlan = effectiveMode === 'PLAN' || run?.status === 'cancelled' ? plan : undefined
  function editPlan(target: Plan) {
    setCapability(target.objective.capability)
    setSelectedSources(target.objective.document_ids.filter(id => documents.some(doc => doc.document_id === id)))
    setCurriculumDays(target.curriculum_days ?? 0)
    setSelectedTask(target.objective.task)
    setEditing(true)
  }

  return (
    <section className="aipollo-assistant" aria-label="Workspace assistant" data-mode={effectiveMode}>
      {features.learning_plans && learningPlanSlot && createPortal(
        <fieldset className="workspace-plan-options"
          disabled={!learningPlansVisible || !learningComposer || capability !== 'LEARN' || selectedTask !== 'answer' ||
            !selection || selectingPlan || busy || restoringConversation}>
          <legend>{text('Chat Learning Plan', 'Kế hoạch học tập cho chat')}</legend>
          {[{ plan_id: '', blueprint: { title: text('No Plan', 'Không chọn kế hoạch') } }, ...visibleLearningPlans].map(plan =>
            <label key={plan.plan_id} className="workspace-source workspace-plan-option" title={plan.blueprint.title}
              data-checked={selectedPlanId === plan.plan_id}>
              <input type="radio" name="chat-learning-plan" value={plan.plan_id} checked={selectedPlanId === plan.plan_id}
                onChange={() => void chooseLearningPlan(plan.plan_id || null)} />
              <span className="sidebar-ellipsis">{plan.blueprint.title}</span>
            </label>)}
          {(hiddenPlanCount > 0 || (showAllPlans && learningPlans.length > 3)) && <button className="workspace-nav-item" type="button"
            aria-expanded={showAllPlans} onClick={() => setShowAllPlans(value => !value)}>
            {showAllPlans ? text('Show less', 'Thu gọn') : text(`Show more (${hiddenPlanCount})`, `Xem thêm (${hiddenPlanCount})`)}
          </button>}
          {activeId && conversation && selection && !selectedPlanId && <button type="button"
            className="workspace-nav-item" onClick={() => void chooseLearningPlan(null)}>
            {text('Keep No Plan', 'Giữ Không chọn kế hoạch')}
          </button>}
        </fieldset>, learningPlanSlot)}
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
                {visiblePlan.state === 'REVIEW' ? 'Ready for review' : visiblePlan.state === 'ACCEPTED' ? 'Accepted' : visiblePlan.state === 'GENERATING' ? text('Preparing schedule', 'Đang lập lịch học') : visiblePlan.state === 'FAILED' ? text('Draft failed', 'Chưa tạo được bản nháp') : 'Cancelled'}
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
            {visiblePlan.state === 'GENERATING' && <p role="status">{text('Reading the selected sources and preparing a study schedule. You can reload this page.', 'Đang đọc nguồn và lập lịch học. Bạn có thể tải lại trang.')}</p>}
            {visiblePlan.state === 'FAILED' && <p role="alert">{visiblePlan.generation_error === 'curriculum_scope_not_found'
              ? text('The requested topic or chapter was not found. Adjust the goal or choose other sources.', 'Không tìm thấy chủ đề hoặc chương yêu cầu. Hãy sửa mục tiêu hoặc chọn nguồn khác.')
              : text('Could not prepare a valid schedule. Regenerate to retry.', 'Chưa tạo được lịch học hợp lệ. Chọn Tạo lại để thử lại.')}</p>}
            {visiblePlan.curriculum_days && <p>{text('Study days', 'Số ngày học')}: {visiblePlan.curriculum_days}. {text('Starting the accepted plan creates all learning materials in order.', 'Chạy kế hoạch đã duyệt sẽ tạo lần lượt toàn bộ học liệu.')}</p>}
            <p className="plan-goal"><strong>GOAL</strong> {visiblePlan.objective.query}</p>
            <ol className="plan-steps">{visiblePlan.steps.map((step, index) => (
              <li key={index}>
                <span className="plan-step-number">{index + 1}</span>
                <span>{step.day && <strong>{text('Day', 'Ngày')} {step.day}: </strong>}{step.action}
                  {step.objective && <small>{' · ' + tasks[step.objective.capability][step.objective.task] + ' · ' + step.objective.query}</small>}
                  {step.objective && <small>{' · ' + step.objective.document_ids.map(id => documents.find(doc => doc.document_id === id)?.name ?? 'Unavailable source').join(', ')}</small>}
                  {step.expected_output && <small>{' · ' + step.expected_output}</small>}
                  {step.citations?.map(citation => <button type="button" className="citation-pill" key={citation.chunk_id}
                    onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}
                </span>
                <span className="badge badge-neutral">{step.tool}</span>
              </li>
            ))}</ol>
            {workflowDraft && <form className="form-stack" onSubmit={event => {
              event.preventDefault()
              if (workflowDraft.some(step => !step.objective.document_ids.length)) {
                setError(text('Choose at least one source for each activity.', 'Chọn ít nhất một nguồn cho mỗi hoạt động.'))
                return
              }
              void perform(async () => {
                const revised = await api<Plan>(base + '/plans/' + visiblePlan.plan_id, 'PATCH', {
                  ...visiblePlan.objective, expected_version: visiblePlan.plan_version, steps: workflowDraft,
                })
                setPlan(revised)
                setWorkflowDraft(undefined)
              })
            }}>
              {workflowDraft.map((step, index) => <fieldset key={step.step_id} disabled={locked}>
                <legend>{text('Activity', 'Hoạt động')} {index + 1}</legend>
                <label>{text('Action', 'Nội dung')}
                  <input value={step.action} required minLength={2} maxLength={600} onChange={event => setWorkflowDraft(rows => rows?.map((row, i) => i === index ? { ...row, action: event.target.value } : row))} />
                </label>
                <label>{text('Question', 'Câu hỏi')}
                  <textarea value={step.objective.query} required minLength={2} maxLength={1800} onChange={event => setWorkflowDraft(rows => rows?.map((row, i) => i === index ? { ...row, objective: { ...row.objective, query: event.target.value } } : row))} />
                </label>
                <label>{text('Output', 'Kết quả')}
                  <input value={step.expected_output} required minLength={2} maxLength={600} onChange={event => setWorkflowDraft(rows => rows?.map((row, i) => i === index ? { ...row, expected_output: event.target.value } : row))} />
                </label>
                <label>{text('Task', 'Tác vụ')}
                  <select value={step.objective.task} onChange={event => setWorkflowDraft(rows => rows?.map((row, i) => i === index ? { ...row, objective: { ...row.objective, task: event.target.value } } : row))}>
                    {Object.entries(tasks[step.objective.capability]).filter(([value]) => !['socratic_tutor', 'mock_defense'].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <div role="group" aria-label={text('Sources for activity', 'Nguồn cho hoạt động') + ' ' + (index + 1)}>
                  {visiblePlan.objective.document_ids.map(id => <label className="check-option" key={id}>
                    <input type="checkbox" checked={step.objective.document_ids.includes(id)}
                      aria-label={text('Activity source', 'Nguồn hoạt động') + ' ' + (index + 1) + ': ' + (documents.find(doc => doc.document_id === id)?.name ?? id)}
                      onChange={event => {
                        const checked = event.currentTarget.checked
                        setWorkflowDraft(rows => rows?.map((row, i) => i === index ? { ...row, objective: { ...row.objective,
                          document_ids: checked ? [...new Set([...row.objective.document_ids, id])] : row.objective.document_ids.filter(source => source !== id),
                        } } : row))
                      }} />{documents.find(doc => doc.document_id === id)?.name ?? text('Unavailable source', 'Nguồn không còn khả dụng')}
                  </label>)}
                </div>
                <button type="button" className="secondary sm" disabled={workflowDraft.length === 1} onClick={() => setWorkflowDraft(rows => rows?.filter((_, i) => i !== index))}>{text('Remove activity', 'Xóa hoạt động')}</button>
              </fieldset>)}
              <button type="button" className="secondary sm" disabled={locked || workflowDraft.length >= 6} onClick={() => setWorkflowDraft(rows => [...(rows ?? []), {
                step_id: crypto.randomUUID(), tool: 'compose', action: visiblePlan.objective.query,
                objective: visiblePlan.objective, expected_output: 'Answer with source citations',
              }])}>{text('Add activity', 'Thêm hoạt động')}</button>
              <button disabled={locked}>{text('Save as new version', 'Lưu phiên bản mới')}</button>
              <button type="button" className="secondary sm" onClick={() => setWorkflowDraft(undefined)}>{text('Cancel editing', 'Hủy chỉnh sửa')}</button>
            </form>}
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
              {(visiblePlan.state === 'REVIEW' || visiblePlan.state === 'ACCEPTED') && (visiblePlan.state === 'REVIEW'
                ? <button type="button" className="sm" disabled={locked} onClick={() => review('accept', visiblePlan)}>{text('Accept plan', 'Duyệt kế hoạch')}</button>
                : <button type="button" className="sm" disabled={locked} onClick={() => review('run', visiblePlan)}>{text('Run accepted plan', 'Chạy kế hoạch đã duyệt')}</button>)}
              {features.custom_plan && visiblePlan.steps.length > 0 && <button type="button" className="secondary sm" disabled={locked} onClick={() => setWorkflowDraft(visiblePlan.steps.map(step => ({
                day: step.day, step_id: step.step_id ?? crypto.randomUUID(), tool: step.tool as PlanStep['tool'], action: step.action,
                objective: step.objective ?? visiblePlan.objective,
                expected_output: step.expected_output ?? 'Answer with source citations',
              })))}>{text('Customize activities', 'Tùy chỉnh hoạt động')}</button>}
            </div>}
          </article>
          {visiblePlan.state === 'REVIEW' && <p className="approval-notice">
            <DesignIcon name="approval-lock" /> No execution has started. Accept this exact version to enable execution. Editing creates a new version.
          </p>}
        </>}
        {run?.interaction === 'PLAN' && stepProgress.length > 0 && <ol aria-label={text('Plan progress', 'Tiến độ kế hoạch')}>
          {stepProgress.map(step => <li key={step.step_id}>{text('Activity', 'Hoạt động')} {step.position + 1} · {step.status}
            {step.result?.answer?.claims.map((claim, index) => <div key={index}>
              <GeneratedContent text={claim.text} fields={claim.fields} kind={step.result?.answer?.kind} />
              {claim.citations.map(citation => <button type="button" key={citation.chunk_id} className="citation-pill"
                onClick={() => onCitation(citation)}>{citation.name}, page {citation.page}</button>)}
            </div>)}
          </li>)}
        </ol>}
        {run && answers(run)}
      </div>

      <form hidden={showHistory} className="assistant-composer" onSubmit={submit} key={editing ? `edit-${plan?.plan_version}` : 'new-form'}>
        {learningComposer && capability === 'LEARN' && selectedTask === 'answer' && learningAction === 'create' &&
          <fieldset className="study-duration" disabled={locked}>
            <legend>{text('How many days would you like to study?', 'Bạn muốn học trong bao nhiêu ngày?')}</legend>
            <div className="study-duration-options">
              {[0, 1, 2, 3, 4, 5, 6, 7].map(day => <label key={day}>
                <input type="radio" name="study-duration" value={day} checked={learningDays === day}
                  onChange={() => setLearningDays(day)} />
                <span>{day === 0 ? text('Auto', 'Tự động') : text(day + (day === 1 ? ' day' : ' days'), day + ' ngày')}</span>
              </label>)}
            </div>
          </fieldset>}
        <textarea ref={queryField} aria-label="Question or objective" name="query" minLength={2} maxLength={1800}
          required rows={2} disabled={locked} defaultValue={editing ? plan?.objective.query : ''}
          onChange={event => {
            if (!learningComposer || capability !== 'LEARN' || selectedTask !== 'answer') return
            const command = event.currentTarget.value.match(/^\/(plan|edit-plan)\s/i)
            if (command) {
              activateCommand(command[1].toLowerCase() === 'plan' ? '/plan' : '/edit-plan')
            } else {
              const prefix = event.currentTarget.value.toLowerCase()
              setCommandPrefix(commands.some(item => item.startsWith(prefix)) && prefix.startsWith('/') ? prefix : undefined)
            }
          }}
          onKeyDown={event => { if (event.key === 'Escape') setCommandPrefix(undefined) }}
          placeholder={editing ? text('Tell the agent how to adjust this plan…', 'Cho biết cần điều chỉnh kế hoạch thế nào…')
            : effectiveMode === 'PLAN' ? text('Describe the goal for your plan…', 'Mô tả mục tiêu của kế hoạch…') : text('Ask a question or type / for commands…', 'Đặt câu hỏi hoặc gõ / để chọn lệnh…')} />
        {learningComposer && commandPrefix && <div className="actions" role="group" aria-label="Learning Plan commands">
          {commands.filter(command => command.startsWith(commandPrefix)).map(command =>
            <button key={command} type="button" className="secondary sm" disabled={locked}
              onClick={() => activateCommand(command)}>{command}</button>)}
        </div>}
        <div className="composer-options">
          <div className="composer-modes" role="group" aria-label="Mode">
            {modes.map(item => <button key={item.value} type="button" disabled={editing || locked}
              aria-pressed={effectiveMode === item.value} onClick={() => {
                setMode(item.value)
                setCapability('LEARN')
                setSelectedTask('answer')
                setCommandPrefix(undefined)
                setLearningAction(undefined)
                setLearningDays(0)
                onModeChange?.(item.value)
              }}>{text(item.label, item.vietnamese)}</button>)}
          </div>
          {effectiveMode === 'ASK' && <select aria-label={text('Citation Mode', 'Chế độ trích dẫn')}
            value={citationMode} disabled={locked}
            onChange={event => chooseCitationMode(event.currentTarget.value === 'chunk' ? 'chunk' : 'segment')}>
            <option value="segment">{text('Segment', 'Đoạn')}</option>
            <option value="chunk">{text('Chunk', 'Khối')}</option>
          </select>}
          {effectiveMode === 'PLAN' && features.curriculum && capability === 'LEARN' && <label>
            {text('Study schedule', 'Lịch học')}
            <select aria-label={text('Study days', 'Số ngày học')} value={curriculumDays} disabled={locked}
              onChange={event => { setCurriculumDays(Number(event.currentTarget.value)); if (Number(event.currentTarget.value)) setSelectedTask('study_guide') }}>
              <option value={0}>{text('Manual plan', 'Kế hoạch thủ công')}</option>
              {[1, 2, 3, 4, 5, 6].map(day => <option value={day} key={day}>{day} {text('days (Study guide)', 'ngày (Study guide)')}</option>)}
            </select>
          </label>}
          <span className="badge badge-neutral composer-source-count"><DesignIcon name="source-count" /> {selectedSources.length} sources</span>
          {features.learning_plans && effectiveMode === 'ASK' && capability === 'LEARN' && selectedTask === 'answer' && <>
            {selection?.unavailable && <span role="status">The previously selected Learning Plan is unavailable.</span>}
            {learningAction && <button type="button" className="secondary sm" disabled={locked}
              aria-label="Remove Learning Plan command" onClick={() => { setLearningAction(undefined); setLearningDays(0) }}>
              {learningAction === 'create' ? '/plan' : '/edit-plan'} ×
            </button>}
          </>}
          {!learningComposer && <><select aria-label="Capability" value={capability} disabled={locked}
            onChange={event => { setCapability(event.currentTarget.value as Capability); setSelectedTask('answer'); setCurriculumDays(0) }}>
            <option value="LEARN">Learn</option><option value="RESEARCH">Research</option><option value="WRITE">Write</option>
          </select>
          <select aria-label="Output" name="task" disabled={locked}
            value={['socratic_tutor', 'mock_defense'].includes(selectedTask) && effectiveMode !== 'ASK' ? 'answer' : selectedTask}
            onChange={event => setSelectedTask(event.currentTarget.value)}>
            {Object.entries(tasks[capability]).filter(([value]) => (value !== 'socratic_tutor' || (features.socratic_tutor && effectiveMode === 'ASK')) && (value !== 'mock_defense' || (features.mock_defense && effectiveMode === 'ASK'))).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></>}
          {learningComposer && (features.socratic_tutor || features.mock_defense) && <details>
            <summary>{text('Specialized Ask', 'Hỏi chuyên biệt')}</summary>
            <select aria-label="Specialized Ask" name="task" value={selectedTask} disabled={locked}
              onChange={event => {
                const task = event.currentTarget.value
                setSelectedTask(task)
                setCapability(task === 'mock_defense' ? 'RESEARCH' : 'LEARN')
                setLearningAction(undefined)
                setCommandPrefix(undefined)
              }}>
              <option value="answer">Answer</option>
              {features.socratic_tutor && <option value="socratic_tutor">Socratic tutor</option>}
              {features.mock_defense && <option value="mock_defense">Mock defense</option>}
            </select>
          </details>}
          {selectedTask === 'mock_defense' && effectiveMode === 'ASK' && <label>{text('Draft to review', 'Bản nháp cần phản biện')}
            <select name="draft_document_id" aria-label={text('Draft to review', 'Bản nháp cần phản biện')} required disabled={locked}>
              {selectedSources.map(id => <option value={id} key={id}>{documents.find(doc => doc.document_id === id)?.name ?? id}</option>)}
            </select>
          </label>}
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
          {conversation && !editing && <button type="button" disabled={locked || selectingPlan} className="ghost sm" onClick={newChat}>New chat</button>}
          {editing && <button type="button" disabled={locked} className="secondary sm"
            onClick={() => setEditing(false)}>Cancel editing</button>}
          <button type="submit" disabled={locked || (learningComposer && capability === 'LEARN' &&
            selectedTask === 'answer' && (!selection || selectingPlan))} className="composer-send"
            aria-label={editing ? 'Save new version' : mode === 'PLAN' ? 'Create plan' : 'Send'}>
            <DesignIcon name="send" />
          </button>
        </div>
      </form>
    </section>
  )
}
