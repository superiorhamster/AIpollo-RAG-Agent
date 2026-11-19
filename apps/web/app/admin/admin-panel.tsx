'use client'

import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../lib/api'

type User = { user_id: string; email: string; role: 'USER' | 'ADMIN'; disabled: boolean }
type Job = { job_id: string; kind: string; status: string; attempts: number; error_code: string | null }
type Health = { service: string; ready: boolean }
type Audit = { request_id: string; action: string; outcome: string; occurred_at: string }
type Models = { provider: string; embedding_model: string | null; chat_model: string | null }

export function AdminPanel() {
  const [users, setUsers] = useState<User[]>()
  const [jobs, setJobs] = useState<Job[]>()
  const [health, setHealth] = useState<Health[]>()
  const [audit, setAudit] = useState<Audit[]>()
  const [models, setModels] = useState<Models>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = '/v1/admin/'

  async function request(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await operation() }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  function change(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void request(async () => {
      const updated = await api<User>(base + 'accounts/' + user.user_id, 'PATCH', {
        role: String(form.get('role')), disabled: form.has('disabled'),
      })
      setUsers(items => items?.map(item => item.user_id === updated.user_id ? updated : item))
    })
  }

  return <div className="form-stack">
    <div className="actions">
      <button disabled={busy} onClick={() => void request(async () => setUsers(await api<User[]>(base + 'accounts')))}>Accounts</button>
      <button disabled={busy} onClick={() => void request(async () => setJobs(await api<Job[]>(base + 'jobs')))}>Jobs</button>
      <button disabled={busy} onClick={() => void request(async () => setAudit(await api<Audit[]>(base + 'audit')))}>Audit</button>
      <button disabled={busy} onClick={() => void request(async () => setHealth(await api<Health[]>(base + 'services')))}>Services</button>
      <button disabled={busy} onClick={() => void request(async () => setModels(await api<Models>(base + 'models')))}>Models</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {users && <section className="panel form-stack"><h2>Accounts</h2>
      {users.map(user => <form key={user.user_id} className="inline-form" onSubmit={event => change(event, user)}>
        <strong>{user.email}</strong>
        <label>Role<select name="role" defaultValue={user.role}><option>USER</option><option>ADMIN</option></select></label>
        <label className="check-option"><input type="checkbox" name="disabled" defaultChecked={user.disabled} /> Suspended</label>
        <button disabled={busy}>Update account</button>
      </form>)}
    </section>}
    {jobs && <section className="panel form-stack"><h2>Processing jobs</h2>
      <ul>{jobs.map(job => <li key={job.job_id}>
        {job.kind} · {job.status} · {job.attempts} attempts {job.error_code && ' · ' + job.error_code}
        {job.status === 'failed' && <button type="button" className="secondary" disabled={busy} onClick={() => {
          void request(async () => {
            await api(base + 'jobs/' + job.job_id + '/retry', 'POST')
            setJobs(await api<Job[]>(base + 'jobs'))
          })
        }}>Retry job</button>}
      </li>)}</ul>
    </section>}
    {audit && <section className="panel"><h2>Identity audit</h2>
      <ul>{audit.map((item, index) => <li key={item.request_id + index}>
        {new Date(item.occurred_at).toLocaleString()} · {item.action} · {item.outcome}
      </li>)}</ul>
    </section>}
    {health && <section className="panel"><h2>Service readiness</h2>
      <ul>{health.map(item => <li key={item.service}>{item.service} · {item.ready ? 'Ready' : 'Unavailable'}</li>)}</ul>
    </section>}
    {models && <section className="panel"><h2>Model configuration</h2>
      <ul><li>Provider · {models.provider}</li><li>Embedding · {models.embedding_model ?? 'Unconfigured'}</li>
        <li>Chat · {models.chat_model ?? 'Unconfigured'}</li></ul>
    </section>}
  </div>
}
