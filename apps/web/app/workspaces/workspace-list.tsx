'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
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
    })
  }

  function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name'))
    void run(async () => {
      const workspace = await api<Workspace>(workspacePath(id), 'PATCH', { name })
      setWorkspaces(current => sortWorkspaces(current.map(item => item.workspace_id === id ? workspace : item)))
      setRenaming(null)
    })
  }

  function remove(workspace: Workspace) {
    if (!window.confirm(`Delete “${workspace.name}” and all of its documents?`)) return
    const id = workspace.workspace_id
    void run(async () => {
      await api(workspacePath(id), 'DELETE')
      setWorkspaces(current => current.filter(item => item.workspace_id !== id))
      if (sharing?.id === id) setSharing(null)
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
        return { id, members: [...current.members.filter(item => item.user_id !== member.user_id), member]
          .sort((a, b) => a.user_id.localeCompare(b.user_id)) }
      })
      form.reset()
    })
  }

  function revoke(workspaceId: string, userId: string) {
    void run(async () => {
      await api(workspacePath(workspaceId) + '/members/' + userId, 'DELETE')
      setSharing(current => current?.id === workspaceId
        ? { id: workspaceId, members: current.members.filter(member => member.user_id !== userId) }
        : current)
    })
  }

  return (
    <div className="workspace-content">
      <form className="panel inline-form" method="post" onSubmit={create}>
        <label>Workspace name<input name="name" maxLength={120} required /></label>
        <button type="submit" disabled={pending}>Create workspace</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {workspaces.length === 0 && <p className="muted">You have no workspaces yet.</p>}
      <div className="workspace-list">
        {workspaces.map(workspace => {
          const id = workspace.workspace_id
          return (
            <article className="panel workspace" aria-labelledby={id} key={id}>
              <header className="workspace-title">
                <h2 id={id}>{workspace.name}</h2>
                <span className="role">{workspace.role.toLowerCase()}</span>
              </header>
              <div className="actions">
                <Link href={`/workspaces/${id}`}>Documents</Link>
                {workspace.role !== 'VIEWER' && (
                  <button className="secondary" type="button" disabled={pending} onClick={() => setRenaming(id)}>Rename</button>
                )}
                {workspace.role === 'OWNER' && (
                  <>
                    <button className="secondary" type="button" disabled={pending} aria-expanded={sharing?.id === id}
                      onClick={() => openSharing(id)}>Sharing</button>
                    <button className="danger" type="button" disabled={pending} onClick={() => remove(workspace)}>Delete</button>
                  </>
                )}
              </div>
              {renaming === id && (
                <form className="inline-form" method="post" onSubmit={event => rename(event, id)}>
                  <label>New name<input name="name" defaultValue={workspace.name} maxLength={120} required /></label>
                  <button type="submit" disabled={pending}>Save name</button>
                  <button className="secondary" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              )}
              {sharing?.id === id && (
                <section className="sharing">
                  <h3>Collaborators</h3>
                  <form className="inline-form" method="post" onSubmit={event => grant(event, id)}>
                    <label>User ID<input name="user_id" maxLength={36} required /></label>
                    <label>Access
                      <select name="role" aria-label="Access">
                        <option value="VIEWER">Viewer</option>
                        <option value="EDITOR">Editor</option>
                      </select>
                    </label>
                    <button type="submit" disabled={pending}>Grant access</button>
                  </form>
                  {sharing.members.length === 0 && <p className="muted">This workspace has no collaborators.</p>}
                  <ul className="members">
                    {sharing.members.map(member => (
                      <li key={member.user_id}>
                        <span className="member-id">{member.user_id}</span>
                        <span className="role">{member.role.toLowerCase()}</span>
                        <button className="danger" type="button" disabled={pending}
                          onClick={() => revoke(id, member.user_id)}>Revoke access</button>
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
