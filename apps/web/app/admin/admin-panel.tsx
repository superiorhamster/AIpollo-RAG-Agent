'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { DesignIcon, type IconName } from '../components/aipollo'
import { api, errorMessage } from '../lib/api'

type User = { user_id: string; email: string; role: 'USER' | 'ADMIN'; disabled: boolean }
type Job = {
  job_id: string; document_id: string; kind: string; status: string
  attempts: number; error_code: string | null; updated_at: string
}
type Health = { service: string; ready: boolean }
type Audit = { request_id: string; actor_id: string | null; target_id: string | null; action: string; outcome: string; occurred_at: string }
type Models = { provider: string; embedding_model: string | null; chat_model: string | null }
type View = 'overview' | 'users' | 'jobs' | 'audit' | 'configuration'
type Role = 'all' | User['role']
type AccountState = 'all' | 'active' | 'disabled'

const sections: { id: View; label: string; icon: IconName; activeIcon?: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', activeIcon: 'overview-active' },
  { id: 'users', label: 'Users', icon: 'users', activeIcon: 'users-active' },
  { id: 'jobs', label: 'Ingestion jobs', icon: 'jobs' },
  { id: 'audit', label: 'Audit log', icon: 'policy-shield' },
  { id: 'configuration', label: 'Configuration', icon: 'configuration' },
]
const base = '/v1/admin/'
const statuses: Record<string, [string, string]> = {
  succeeded: ['Ready', 'success'], running: ['Processing', 'warning'],
  queued: ['Queued', 'info'], failed: ['Failed', 'danger'], cancelled: ['Cancelled', 'neutral'],
}

function dateTime(value: string) {
  return new Date(value).toLocaleString()
}

export function AdminPanel({ currentUser }: { currentUser: string }) {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>()
  const [jobs, setJobs] = useState<Job[]>()
  const [health, setHealth] = useState<Health[]>()
  const [audit, setAudit] = useState<Audit[]>()
  const [models, setModels] = useState<Models>()
  const [view, setView] = useState<View>('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loads, setLoads] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role>('all')
  const [accountState, setAccountState] = useState<AccountState>('all')

  useEffect(() => {
    let active = true
    const load = async <T,>(key: string, set: (value: T) => void) => {
      try {
        const data = await api<T>(base + key)
        if (active) set(data)
      } catch (failure) {
        if (active) setLoads(current => ({ ...current, [key]: errorMessage(failure) }))
      }
    }
    void Promise.all([
      load<Health[]>('services', setHealth), load<Job[]>('jobs', setJobs), load<Audit[]>('audit', setAudit),
      load<User[]>('accounts', setUsers), load<Models>('models', setModels),
    ])
    return () => { active = false }
  }, [])

  async function request(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await operation() }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  function change(user: User, nextRole: User['role'], disabled: boolean) {
    if (nextRole === user.role && disabled === user.disabled) return
    const action = disabled !== user.disabled ? (disabled ? 'Deactivate' : 'Reactivate') : 'Change the role of'
    if (!window.confirm(action + ' ' + user.email + '? This revokes their sessions.')) return
    void request(async () => {
      const updated = await api<User>(base + 'accounts/' + user.user_id, 'PATCH', { role: nextRole, disabled })
      setUsers(items => items?.map(item => item.user_id === updated.user_id ? updated : item))
      setAudit(await api<Audit[]>(base + 'audit'))
    })
  }

  function updateRole(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault()
    const role = new FormData(event.currentTarget).get('role')
    if (role === 'USER' || role === 'ADMIN') change(user, role, user.disabled)
  }

  function retry(job: Job) {
    void request(async () => {
      await api(base + 'jobs/' + job.job_id + '/retry', 'POST')
      setJobs(await api<Job[]>(base + 'jobs'))
    })
  }

  function errorOrLoading(key: string, empty: boolean) {
    return loads[key] ? <p role="alert">{loads[key]}</p> : empty ? <p role="status">Loading…</p> : null
  }

  function jobTable(rows?: Job[]) {
    if (!rows) return errorOrLoading('jobs', true)
    if (!rows.length) return <p className="muted">No ingestion jobs.</p>
    return <div className="aipollo-table-scroll"><table className="aipollo-table">
      <thead><tr><th scope="col">Job</th><th scope="col">Document ID</th><th scope="col">State</th>
        <th scope="col">Tries</th><th scope="col">Updated</th><th scope="col">Action</th></tr></thead>
      <tbody>{rows.map(job => {
        const [label, color] = statuses[job.status] ?? [job.status, 'neutral']
        return <tr key={job.job_id}>
          <th scope="row"><span title={job.job_id}>{job.job_id.slice(0, 8)}</span> · {job.kind}</th>
          <td title={job.document_id}>{job.document_id.slice(0, 8)}</td>
          <td><span className={'badge badge-' + color}>{label}</span>
            {job.error_code && <div className="muted">{job.error_code.replaceAll('_', ' ')}</div>}</td>
          <td>{job.attempts}</td><td>{dateTime(job.updated_at)}</td>
          <td>{job.status === 'failed' && <button className="secondary sm" type="button" disabled={busy}
            onClick={() => retry(job)}>Retry job</button>}</td>
        </tr>
      })}</tbody>
    </table></div>
  }

  function auditTable(rows?: Audit[]) {
    if (!rows) return errorOrLoading('audit', true)
    if (!rows.length) return <p className="muted">No audit events.</p>
    return <div className="aipollo-table-scroll"><table className="aipollo-table">
      <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th>
        <th scope="col">Target</th><th scope="col">Result</th></tr></thead>
      <tbody>{rows.map((item, i) => <tr key={item.request_id + i}>
        <td>{dateTime(item.occurred_at)}</td><td title={item.actor_id ?? undefined}>{item.actor_id?.slice(0, 8) ?? 'System'}</td>
        <td>{item.action}</td><td title={item.target_id ?? undefined}>{item.target_id?.slice(0, 8) ?? '—'}</td>
        <td><span className={`badge badge-${item.outcome === 'success' ? 'success' : 'neutral'}`}>{item.outcome}</span></td>
      </tr>)}</tbody>
    </table></div>
  }

  const visibleUsers = users?.filter(user =>
    user.email.toLowerCase().includes(query.trim().toLowerCase()) &&
    (role === 'all' || user.role === role) &&
    (accountState === 'all' || user.disabled === (accountState === 'disabled')))
  const ready = health?.filter(item => item.ready).length
  const configuration = <aside className="admin-config form-stack" aria-label="System configuration">
    <h2>System configuration</h2>
    <p className="muted">Settings supplied by the deployment.</p>
    {errorOrLoading('models', !models)}
    {models && <dl>
      <div><dt>Provider</dt><dd>{models.provider}</dd></div>
      <div><dt>Embedding model</dt><dd>{models.embedding_model ?? 'Unavailable'}</dd></div>
      <div><dt>Generation model</dt><dd>{models.chat_model ?? 'Unavailable'}</dd></div>
      <div><dt>Maximum upload size</dt><dd>25 MiB</dd></div>
    </dl>}
    <span className="admin-secrets"><DesignIcon name="configuration-lock" /> API keys are hidden</span>
  </aside>

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <nav aria-label="Admin console navigation" className="workspace-nav">
          {sections.map(item => <button className="workspace-nav-item" type="button" key={item.id}
            aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}>
            <DesignIcon name={view === item.id ? item.activeIcon ?? item.icon : item.icon} /> {item.label}
          </button>)}
        </nav>
        <button type="button" className="workspace-nav-item admin-logout" disabled={busy}
          onClick={() => void request(async () => {
            await api('/v1/auth/logout', 'POST')
            router.replace('/sign-in')
            router.refresh()
          })}><DesignIcon name="logout" /> Sign out</button>
      </aside>
      <div className="admin-content">
        {error && <p role="alert">{error}</p>}
        {view === 'overview' && <>
          <header className="aipollo-section-heading"><div><h1>Operations overview</h1>
            <p>Service status and job metadata</p></div></header>
          <dl className="admin-metrics">
            <div><dt>Services healthy</dt><dd>{health ? `${ready} / ${health.length}` : '—'}</dd></div>
            <div><dt>Processing jobs</dt><dd>{jobs?.filter(job => job.status === 'running').length ?? '—'}</dd></div>
            <div><dt>Failed jobs</dt><dd>{jobs?.filter(job => job.status === 'failed').length ?? '—'}</dd></div>
            <div><dt>Model provider</dt><dd>{models?.provider ?? '—'}</dd></div>
          </dl>
          <section className="admin-section"><h2>Service health</h2>
            {errorOrLoading('services', !health)}
            <ul className="admin-service-list">{health?.map(item => <li key={item.service}
              className={`badge badge-${item.ready ? 'neutral' : 'warning'}`}>
              <span className={`status-indicator ${item.ready ? 'success' : 'failed'}`} /> {item.service}
            </li>)}</ul>
          </section>
          <section className="admin-section"><h2>Document ingestion jobs</h2>{jobTable(jobs?.slice(0, 5))}</section>
          <section className="admin-section">
            <header className="aipollo-section-heading"><h2>Recent audit events</h2>
              <button className="secondary sm" type="button" onClick={() => setView('audit')}>Open audit log</button></header>
            {auditTable(audit?.slice(0, 5))}
          </section>
        </>}
        {view === 'users' && <div className="admin-user-layout">
          <div className="admin-section">
            <header className="aipollo-section-heading"><div><h1>Users</h1><p>Account status and role</p></div></header>
            <div className="admin-filters">
              <input type="search" aria-label="Search by email" placeholder="Search by email…" value={query} onChange={event => setQuery(event.currentTarget.value)} />
              <select aria-label="Filter by role" value={role} onChange={event => setRole(event.currentTarget.value as Role)}>
                <option value="all">Role: all</option><option value="USER">User</option><option value="ADMIN">Admin</option>
              </select>
              <select aria-label="Filter by account status" value={accountState} onChange={event => setAccountState(event.currentTarget.value as AccountState)}>
                <option value="all">Status: all</option><option value="active">Active</option><option value="disabled">Deactivated</option>
              </select>
            </div>
            {errorOrLoading('accounts', !users)}
            {visibleUsers?.length === 0 && <p className="muted">No matching accounts.</p>}
            {!!visibleUsers?.length && <div className="aipollo-table-scroll"><table className="aipollo-table">
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
              <tbody>{visibleUsers.map(user => <tr key={user.user_id}>
                <th scope="row">{user.email}</th>
                <td>{user.user_id === currentUser
                  ? <span className="badge badge-info">Admin</span>
                  : <form className="admin-role-form" key={user.role} onSubmit={event => updateRole(event, user)}>
                    <select name="role" aria-label={'Role for ' + user.email} defaultValue={user.role} disabled={busy}>
                      <option value="USER">User</option><option value="ADMIN">Admin</option></select>
                    <button className="secondary sm" disabled={busy}>Save role</button>
                  </form>}</td>
                <td><span className={`badge badge-${user.disabled ? 'danger' : 'success'}`}>{user.disabled ? 'Deactivated' : 'Active'}</span></td>
                <td>{user.user_id === currentUser ? 'Current account'
                  : <button className={user.disabled ? 'secondary sm' : 'danger sm'} type="button" disabled={busy}
                    onClick={() => change(user, user.role, !user.disabled)}>{user.disabled ? 'Reactivate' : 'Deactivate'}</button>}</td>
              </tr>)}</tbody>
            </table></div>}
            <h2>Audit log</h2>{auditTable(audit?.slice(0, 5))}
          </div>
          {configuration}
        </div>}
        {view === 'jobs' && <section className="admin-section"><h1>Ingestion jobs</h1>{jobTable(jobs)}</section>}
        {view === 'audit' && <section className="admin-section"><h1>Audit log</h1>{auditTable(audit)}</section>}
        {view === 'configuration' && configuration}
      </div>
    </div>
  )
}
