'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import {
  FolderPlus,
  Folder,
  FileText,
  Share2,
  Trash2,
  Edit3,
  Users,
  AlertCircle,
  ArrowRight,
  Shield,
  User,
} from 'lucide-react'
import { api, ApiError, RenewalUnconfirmed, errorMessage, type Member, type Workspace } from '../lib/api'

function workspacePath(id: string) {
  return `/v1/workspaces/${id}`
}

function sortWorkspaces(workspaces: Workspace[]) {
  return [...workspaces].sort((a, b) => a.name.localeCompare(b.name) || a.workspace_id.localeCompare(b.workspace_id))
}

export function WorkspaceList({ initial }: { initial: Workspace[] }) {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [sharing, setSharing] = useState<{ id: string; members: Member[] } | null>(null)
  const createKey = useRef<{ name: string; key: string } | null>(null)

  async function run(operation: () => Promise<void>) {
    setPending(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        router.replace(failure instanceof RenewalUnconfirmed ? '/sign-in?renewal=unconfirmed' : '/sign-in')
        router.refresh()
      } else {
        setError(errorMessage(failure))
      }
    } finally {
      setPending(false)
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get('name')).trim()
    void run(async () => {
      if (createKey.current?.name !== name) createKey.current = { name, key: crypto.randomUUID() }
      const workspace = await api<Workspace>('/v1/workspaces', 'POST', { name }, createKey.current.key)
      setWorkspaces(current => sortWorkspaces([...current.filter(item => item.workspace_id !== workspace.workspace_id), workspace]))
      createKey.current = null
      form.reset()
      router.refresh()
    })
  }

  function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name'))
    void run(async () => {
      const workspace = await api<Workspace>(workspacePath(id), 'PATCH', { name })
      setWorkspaces(current => sortWorkspaces(current.map(item => item.workspace_id === id ? workspace : item)))
      setRenaming(null)
      router.refresh()
    })
  }

  function remove(workspace: Workspace) {
    if (!window.confirm(`Delete “${workspace.name}” and all of its documents?`)) return
    const id = workspace.workspace_id
    void run(async () => {
      await api(workspacePath(id), 'DELETE')
      setWorkspaces(current => current.filter(item => item.workspace_id !== id))
      if (sharing?.id === id) setSharing(null)
      router.refresh()
    })
  }

  function openSharing(id: string) {
    if (sharing?.id === id) {
      setSharing(null)
      return
    }
    void run(async () => {
      setSharing({ id, members: await api<Member[]>(workspacePath(id) + '/members') })
    })
  }

  function grant(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const userId = String(fields.get('user_id')).trim()
    const role = String(fields.get('role'))
    void run(async () => {
      const member = await api<Member>(workspacePath(id) + '/members/' + encodeURIComponent(userId), 'PUT', { role })
      setSharing(current => {
        if (!current || current.id !== id) return current
        return {
          id,
          members: [...current.members.filter(item => item.user_id !== member.user_id), member]
            .sort((a, b) => a.user_id.localeCompare(b.user_id)),
        }
      })
      form.reset()
    })
  }

  function revoke(workspaceId: string, userId: string) {
    void run(async () => {
      await api(workspacePath(workspaceId) + '/members/' + userId, 'DELETE')
      setSharing(current =>
        current?.id === workspaceId
          ? { id: workspaceId, members: current.members.filter(member => member.user_id !== userId) }
          : current
      )
    })
  }

  return (
    <div className="workspace-content">
      {/* Create Workspace Panel */}
      <form className="panel inline-form" method="post" onSubmit={create} style={{ alignItems: 'flex-end', gap: '0.85rem' }}>
        <label style={{ flex: '1 1 18rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <FolderPlus size={16} aria-hidden="true" />
            <span>Workspace name</span>
          </span>
          <input name="name" maxLength={120} required placeholder="e.g. Cognitive Neuroscience Lab" />
        </label>
        <button type="submit" disabled={pending} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <FolderPlus size={16} aria-hidden="true" />
          <span>Create workspace</span>
        </button>
      </form>

      {error && (
        <p role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {workspaces.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', display: 'grid', gap: '0.75rem', justifyItems: 'center' }}>
          <div style={{ width: '3rem', height: '3rem', borderRadius: '50%', background: 'var(--surface-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            <Folder size={24} aria-hidden="true" />
          </div>
          <p className="muted" style={{ fontSize: '0.95rem' }}>You have no workspaces yet. Create one above to begin organizing research papers.</p>
        </div>
      )}

      {/* Workspaces List */}
      <div className="workspace-list">
        {workspaces.map(workspace => {
          const id = workspace.workspace_id
          const isOwner = workspace.role === 'OWNER'
          const canEdit = workspace.role !== 'VIEWER'

          return (
            <article className="panel workspace" aria-labelledby={id} key={id} style={{ display: 'grid', gap: '1rem' }}>
              <header className="workspace-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div style={{ color: 'var(--accent)' }}>
                    <Folder size={20} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <h2 id={id} style={{ fontSize: '1.25rem', margin: 0 }}>{workspace.name}</h2>
                </div>
                <span className={`badge badge-role ${isOwner ? 'badge-primary' : 'badge-neutral'}`}>
                  {isOwner ? <Shield size={12} aria-hidden="true" /> : <User size={12} aria-hidden="true" />}
                  <span>{workspace.role.toLowerCase()}</span>
                </span>
              </header>

              <div className="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
                <Link
                  href={`/workspaces/${id}`}
                  className="button"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span>Documents</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>

                {canEdit && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={pending}
                    onClick={() => setRenaming(id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <Edit3 size={14} aria-hidden="true" />
                    <span>Rename</span>
                  </button>
                )}

                {isOwner && (
                  <>
                    <button
                      className="secondary"
                      type="button"
                      disabled={pending}
                      aria-expanded={sharing?.id === id}
                      onClick={() => openSharing(id)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Share2 size={14} aria-hidden="true" />
                      <span>Sharing</span>
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={pending}
                      onClick={() => remove(workspace)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>

              {renaming === id && (
                <form
                  className="inline-form"
                  method="post"
                  onSubmit={event => rename(event, id)}
                  style={{ padding: '0.85rem', background: 'var(--surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}
                >
                  <label style={{ flex: '1 1 14rem' }}>
                    New name
                    <input name="name" defaultValue={workspace.name} maxLength={120} required />
                  </label>
                  <button type="submit" disabled={pending}>
                    Save name
                  </button>
                  <button className="secondary" type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              )}

              {sharing?.id === id && (
                <section className="sharing" style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.75rem' }}>
                    <Users size={16} aria-hidden="true" />
                    <h3 style={{ margin: 0 }}>Collaborators</h3>
                  </div>

                  <form className="inline-form" method="post" onSubmit={event => grant(event, id)}>
                    <label style={{ flex: '1 1 12rem' }}>
                      User ID
                      <input name="user_id" maxLength={36} required placeholder="UUID of researcher" />
                    </label>
                    <label style={{ width: '8rem' }}>
                      Access
                      <select name="role" aria-label="Access">
                        <option value="VIEWER">Viewer</option>
                        <option value="EDITOR">Editor</option>
                      </select>
                    </label>
                    <button type="submit" disabled={pending}>
                      Grant access
                    </button>
                  </form>

                  {sharing.members.length === 0 && (
                    <p className="muted" style={{ marginTop: '0.75rem' }}>This workspace has no collaborators.</p>
                  )}

                  <ul className="members" style={{ marginTop: '0.75rem' }}>
                    {sharing.members.map(member => (
                      <li key={member.user_id}>
                        <span className="member-id">{member.user_id}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="badge badge-role badge-secondary">
                            {member.role.toLowerCase()}
                          </span>
                          <button
                            className="danger sm"
                            type="button"
                            disabled={pending}
                            onClick={() => revoke(id, member.user_id)}
                          >
                            Revoke access
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
