'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { learningPlanDays } from './learning-plan-days'

type Objective = { id?: string; day: number; goal: string; activities: string[]; progress: 'pending' | 'completed' }
type Blueprint = { title: string; days: number; objectives: Objective[] }
type Plan = { plan_id: string; state_revision: number; blueprint: Blueprint }

function move<T>(items: T[], index: number, offset: number): T[] {
  const copy = [...items]
  const [item] = copy.splice(index, 1)
  copy.splice(index + offset, 0, item)
  return copy
}

function emptyObjective(): Objective {
  return { day: 1, goal: '', activities: [], progress: 'pending' }
}

export function LearningPlanManager({ workspaceId, initialPlanId }: { workspaceId: string; initialPlanId?: string }) {
  const { text } = useWorkspaceLanguage()
  const base = '/v1/workspaces/' + workspaceId + '/learning-plans'
  const [plans, setPlans] = useState<Plan[]>()
  const [current, setCurrent] = useState<Plan>()
  const [draft, setDraft] = useState<Blueprint>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const createRequest = useRef<{ body: string; key: string } | null>(null)

  useEffect(() => {
    let active = true
    void api<Plan[]>(base).then(value => {
      if (!active) return
      setPlans(value)
      const selected = value.find(plan => plan.plan_id === initialPlanId)
      if (selected) {
        setCurrent(selected)
        setDraft(undefined)
      }
    })
      .catch(failure => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [base, initialPlanId])

  function open(plan?: Plan) {
    setCurrent(plan)
    setDraft(plan ? undefined : { title: '', days: 1, objectives: [emptyObjective()] })
    setConfirmDelete(false)
    setError('')
    createRequest.current = null
  }

  function changeObjective(index: number, objective: Objective) {
    setDraft(value => value && ({
      ...value, objectives: value.objectives.map((item, position) => position === index ? objective : item),
    }))
  }

  function moveObjectiveUp(index: number, predecessor: number) {
    setDraft(value => {
      if (!value) return value
      const objectives = [...value.objectives]
      const previous = objectives[predecessor]
      objectives[predecessor] = objectives[index]
      objectives[index] = previous
      return { ...value, objectives }
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    setBusy(true)
    setError('')
    try {
      const body = JSON.stringify(draft)
      if (!current && createRequest.current?.body !== body) createRequest.current = { body, key: crypto.randomUUID() }
      const saved = current
        ? await api<Plan>(base + '/' + current.plan_id, 'PUT', { revision: current.state_revision, blueprint: draft })
        : await api<Plan>(base, 'POST', draft, createRequest.current?.key)
      setPlans(items => [saved, ...(items ?? []).filter(item => item.plan_id !== saved.plan_id)])
      open(saved)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!current || busy) return
    setBusy(true)
    setError('')
    try {
      await api(base + '/' + current.plan_id, 'DELETE', { revision: current.state_revision })
      setPlans(items => items?.filter(item => item.plan_id !== current.plan_id))
      setDraft(undefined)
      setCurrent(undefined)
      setConfirmDelete(false)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const completed = current?.blueprint.objectives.filter(item => item.progress === 'completed').length ?? 0
  const summary = (blueprint: Blueprint) => text(
    `${blueprint.days} ${blueprint.days === 1 ? 'day' : 'days'} · ${blueprint.objectives.length} ${blueprint.objectives.length === 1 ? 'objective' : 'objectives'}`,
    `${blueprint.days} ngày · ${blueprint.objectives.length} mục tiêu`,
  )
  const dayLabel = (day: number, count: number) => text(
    `${day ? 'Day ' + day : 'Day not assigned'} · ${count} ${count === 1 ? 'objective' : 'objectives'}`,
    `${day ? 'Ngày ' + day : 'Chưa chọn ngày'} · ${count} mục tiêu`,
  )

  return <section className="aipollo-library form-stack" aria-labelledby="learning-plans-heading">
    <header className="aipollo-section-heading">
      <h1 id="learning-plans-heading">{text('Learning Plans', 'Kế hoạch học tập')}</h1>
      <button type="button" disabled={busy} onClick={() => open()}>{text('New manual plan', 'Tạo kế hoạch thủ công')}</button>
    </header>
    {error && <p role="alert">{error}</p>}
    {!plans && !error && <p role="status">{text('Loading Learning Plans…', 'Đang tải kế hoạch học tập…')}</p>}
    {plans?.length === 0 && <p>{text('No Learning Plans yet.', 'Chưa có kế hoạch học tập.')}</p>}
    <div className="learning-manager-layout" data-has-list={Boolean(plans?.length)}>
    {!!plans?.length && <ul className="learning-manager-list" aria-label={text('Your Learning Plans', 'Kế hoạch học tập của bạn')}>
      {plans.map(plan => <li key={plan.plan_id}>
        <button type="button" className="secondary" disabled={busy} onClick={() => open(plan)}
          aria-current={current?.plan_id === plan.plan_id ? 'true' : undefined}>{plan.blueprint.title}</button>
        <small>{summary(plan.blueprint)}</small>
      </li>)}
    </ul>}
    {current && !draft && <section className="learning-manager-content form-stack" aria-label={text('Plan detail', 'Chi tiết kế hoạch')}>
      <header className="aipollo-section-heading">
        <div><h2>{current.blueprint.title}</h2><p>{summary(current.blueprint)}</p></div>
        <button type="button" className="secondary" onClick={() => { setDraft(current.blueprint); setError('') }}>
          {text('Edit plan', 'Chỉnh sửa kế hoạch')}
        </button>
      </header>
      <label className="learning-manager-progress">
        <span>{text(`${completed}/${current.blueprint.objectives.length} complete`, `${completed}/${current.blueprint.objectives.length} đã hoàn thành`)}</span>
        <progress value={completed} max={current.blueprint.objectives.length} />
      </label>
      {learningPlanDays(current.blueprint.days, current.blueprint.objectives).map(([day, objectives]) =>
        <details key={day} className="learning-manager-day" open>
          <summary>{dayLabel(day, objectives.length)}</summary>
          {objectives.length === 0 && <p>{text('No objectives', 'Chưa có mục tiêu')}</p>}
          {objectives.map(({ objective }) => <div key={objective.id} className="learning-manager-objective">
            <div className="learning-objective-heading">
              <h3>{objective.goal}</h3>
              <span className={`badge badge-${objective.progress === 'completed' ? 'success' : 'neutral'}`}>
                {objective.progress === 'completed' ? text('Completed', 'Hoàn thành') : text('Pending', 'Chưa hoàn thành')}
              </span>
            </div>
            {objective.activities.length > 0 && <>
              <h4>{text('Suggested activities', 'Hoạt động gợi ý')}</h4>
              <ul>{objective.activities.map((activity, index) => <li key={index}>{activity}</li>)}</ul>
            </>}
          </div>)}
        </details>)}
    </section>}
    {draft && <form className="learning-manager-content form-stack" onSubmit={save}>
      <fieldset disabled={busy} className="form-stack">
        <legend>{current ? text('Edit Learning Plan', 'Chỉnh sửa kế hoạch') : text('Create Learning Plan', 'Tạo kế hoạch')}</legend>
        <label>{text('Plan name', 'Tên kế hoạch')}<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>{text('Days', 'Số ngày')}<select value={draft.days} onChange={event => setDraft({ ...draft, days: Number(event.target.value) })}>
          {Array.from({ length: 7 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}
        </select></label>
        {draft.objectives.some(item => item.day > draft.days) &&
          <p role="status">{text('Move objectives from days beyond the new duration before saving.', 'Chuyển mục tiêu ở các ngày vượt thời lượng mới trước khi lưu.')}</p>}
        {learningPlanDays(draft.days, draft.objectives).map(([day, objectives]) =>
          <fieldset key={day} className="learning-manager-day form-stack">
          <legend>{dayLabel(day, objectives.length)}</legend>
          {objectives.map(({ objective: item, index }, positionInDay) => <fieldset className="learning-manager-objective form-stack" key={item.id ?? index}>
          <legend>{text(`Objective ${positionInDay + 1}`, `Mục tiêu ${positionInDay + 1}`)}</legend>
          <label>{text('Day', 'Ngày')}<select value={item.day}
            onChange={event => changeObjective(index, { ...item, day: Number(event.target.value) })}>
            {item.day > draft.days && <option value={item.day}>{item.day}</option>}
            {Array.from({ length: draft.days }, (_, dayIndex) => <option key={dayIndex + 1}>{dayIndex + 1}</option>)}
          </select></label>
          <label>{text('Learning goal', 'Mục tiêu học tập')}<textarea required value={item.goal}
            onChange={event => changeObjective(index, { ...item, goal: event.target.value })} /></label>
          {item.id && <label className="learning-editor-check"><input type="checkbox" checked={item.progress === 'completed'}
            onChange={event => changeObjective(index, { ...item, progress: event.target.checked ? 'completed' : 'pending' })} /> {text('Completed', 'Hoàn thành')}</label>}
          <h4>{text('Suggested activities', 'Hoạt động gợi ý')}</h4>
          {item.activities.map((activity, position) => <div key={position}>
            <label>{text(`Activity ${position + 1}`, `Hoạt động ${position + 1}`)}<input required value={activity} onChange={event => changeObjective(index, {
              ...item, activities: item.activities.map((entry, i) => i === position ? event.target.value : entry),
            })} /></label>
            <div className="actions">
              <button type="button" className="secondary sm" disabled={position === 0} onClick={() => changeObjective(index, { ...item, activities: move(item.activities, position, -1) })}>{text('Move activity up', 'Chuyển hoạt động lên')}</button>
              <button type="button" className="secondary sm" onClick={() => changeObjective(index, { ...item, activities: item.activities.filter((_, i) => i !== position) })}>{text('Remove activity', 'Xóa hoạt động')}</button>
            </div>
          </div>)}
          <div className="actions">
            <button type="button" className="secondary sm" onClick={() => changeObjective(index, { ...item, activities: [...item.activities, ''] })}>{text('Add activity', 'Thêm hoạt động')}</button>
            <button type="button" className="secondary sm" disabled={positionInDay === 0}
              onClick={() => moveObjectiveUp(index, objectives[positionInDay - 1].index)}>{text('Move objective up', 'Chuyển mục tiêu lên')}</button>
            <button type="button" className="secondary sm" disabled={draft.objectives.length <= 1}
              onClick={() => setDraft({ ...draft, objectives: draft.objectives.filter((_, i) => i !== index) })}>{text('Remove objective', 'Xóa mục tiêu')}</button>
          </div>
          </fieldset>)}
          <button type="button" className="secondary sm" onClick={() =>
            setDraft({ ...draft, objectives: [...draft.objectives, { ...emptyObjective(), day: day || 1 }] })}>
            {text('Add objective', 'Thêm mục tiêu')}
          </button>
          </fieldset>)}
        <div className="actions">
          <button type="submit">{busy ? text('Saving…', 'Đang lưu…') : text('Save plan', 'Lưu kế hoạch')}</button>
          <button type="button" className="secondary" onClick={() => {
            setDraft(undefined); setConfirmDelete(false); setError(''); createRequest.current = null
          }}>{text('Cancel', 'Hủy')}</button>
          {current && !confirmDelete && <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>{text('Delete plan', 'Xóa kế hoạch')}</button>}
        </div>
        {confirmDelete && <div role="group" aria-label={text('Confirm deletion', 'Xác nhận xóa')}>
          <p>{text('Delete this Learning Plan?', 'Xóa kế hoạch học tập này?')}</p>
          <div className="actions">
            <button type="button" className="danger" onClick={remove}>{text('Confirm deletion', 'Xác nhận xóa')}</button>
            <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>{text('Keep plan', 'Giữ kế hoạch')}</button>
          </div>
        </div>}
      </fieldset>
    </form>}
    </div>
  </section>
}
