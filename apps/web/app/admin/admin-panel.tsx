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
  const [activeTab, setActiveTab] = useState<'accounts' | 'jobs' | 'audit' | 'services' | 'models' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = '/v1/admin/'

  async function request(operation: () => Promise<void>) {
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

  function change(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void request(async () => {
      const updated = await api<User>(base + 'accounts/' + user.user_id, 'PATCH', {
        role: String(form.get('role')),
        disabled: form.has('disabled'),
      })
      setUsers(items => items?.map(item => (item.user_id === updated.user_id ? updated : item)))
    })
  }

  return (
    <div className="form-stack">
      <div className="panel-tabs actions" role="tablist" aria-label="Admin console navigation">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'accounts' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setActiveTab('accounts')
            void request(async () => setUsers(await api<User[]>(base + 'accounts')))
          }}
        >
          Accounts
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'jobs' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setActiveTab('jobs')
            void request(async () => setJobs(await api<Job[]>(base + 'jobs')))
          }}
        >
          Jobs
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setActiveTab('audit')
            void request(async () => setAudit(await api<Audit[]>(base + 'audit')))
          }}
        >
          Audit
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setActiveTab('services')
            void request(async () => setHealth(await api<Health[]>(base + 'services')))
          }}
        >
          Services
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'models' ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setActiveTab('models')
            void request(async () => setModels(await api<Models>(base + 'models')))
          }}
        >
          Models
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {users && (
        <section className="panel form-stack">
          <div className="panel-header">
            <h2>Accounts</h2>
            <span className="badge badge-neutral">{users.length} registered</span>
          </div>
          <div className="form-stack">
            {users.map(user => (
              <form
                key={user.user_id}
                className="inline-form"
                style={{
                  padding: '0.85rem',
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  alignItems: 'center',
                }}
                onSubmit={event => change(event, user)}
              >
                <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                  <strong>{user.email}</strong>
                  <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                    {user.user_id}
                  </div>
                </div>
                <label>
                  Role
                  <select name="role" defaultValue={user.role}>
                    <option>USER</option>
                    <option>ADMIN</option>
                  </select>
                </label>
                <label className="check-option">
                  <input type="checkbox" name="disabled" defaultChecked={user.disabled} /> Suspended
                </label>
                <button disabled={busy}>Update account</button>
              </form>
            ))}
          </div>
        </section>
      )}

      {jobs && (
        <section className="panel form-stack">
          <div className="panel-header">
            <h2>Processing jobs</h2>
            <span className="badge badge-neutral">{jobs.length} jobs</span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {jobs.map(job => (
              <li
                key={job.job_id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.65rem 0.85rem',
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span
                    className={`status-indicator ${
                      job.status === 'succeeded'
                        ? 'success'
                        : job.status === 'failed'
                        ? 'failed'
                        : job.status === 'running'
                        ? 'running'
                        : 'queued'
                    }`}
                  />
                  <span>
                    {job.kind} · {job.status} · {job.attempts} attempts{job.error_code && ' · ' + job.error_code}
                  </span>
                </div>
                {job.status === 'failed' && (
                  <button
                    type="button"
                    className="secondary sm"
                    disabled={busy}
                    onClick={() => {
                      void request(async () => {
                        await api(base + 'jobs/' + job.job_id + '/retry', 'POST')
                        setJobs(await api<Job[]>(base + 'jobs'))
                      })
                    }}
                  >
                    Retry job
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {audit && (
        <section className="panel form-stack">
          <div className="panel-header">
            <h2>Identity audit</h2>
            <span className="badge badge-neutral">{audit.length} entries</span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {audit.map((item, index) => (
              <li
                key={item.request_id + index}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                }}
              >
                {new Date(item.occurred_at).toLocaleString()} · {item.action} · {item.outcome}
              </li>
            ))}
          </ul>
        </section>
      )}

      {health && (
        <section className="panel form-stack">
          <div className="panel-header">
            <h2>Service readiness</h2>
            <span className="badge badge-neutral">{health.length} services</span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            {health.map(item => (
              <li
                key={item.service}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.65rem 0.85rem',
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span className={`status-indicator ${item.ready ? 'ready' : 'failed'}`} />
                <span>
                  {item.service} · {item.ready ? 'Ready' : 'Unavailable'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {models && (
        <section className="panel form-stack">
          <div className="panel-header">
            <h2>Model configuration</h2>
            <span className="badge badge-info">{models.provider}</span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
            <li
              style={{
                padding: '0.65rem 0.85rem',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Provider · {models.provider}
            </li>
            <li
              style={{
                padding: '0.65rem 0.85rem',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Embedding · {models.embedding_model ?? 'Unconfigured'}
            </li>
            <li
              style={{
                padding: '0.65rem 0.85rem',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Chat · {models.chat_model ?? 'Unconfigured'}
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
