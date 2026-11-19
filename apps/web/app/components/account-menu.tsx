'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { Brand, DesignIcon } from './aipollo'
import { useWorkspaceLanguage, WorkspaceLanguage } from './workspace-language'
import { api, errorMessage } from '../lib/api'

type SearchEntry = { name: string; href: string; kind: 'Workspace' | 'Source'; documentId?: string }

export function AccountMenu({ email, compact = false, admin = false, workspace = false, search = [], onSelectSource }: {
  email?: string
  compact?: boolean
  admin?: boolean
  workspace?: boolean
  search?: SearchEntry[]
  onSelectSource?: (documentId: string) => void
}) {
  const router = useRouter()
  const { text } = useWorkspaceLanguage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchId = useId()
  const initials = email?.split('@')[0].split(/[._-]+/).filter(Boolean)
  const avatar = initials?.length ? (initials.length > 1 ? initials[0][0] + initials[1][0] : initials[0].slice(0, 2)).toUpperCase() : 'U'
  const matches = query.trim() ? search.filter(entry =>
    entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8) : []

  async function signOut() {
    setPending(true)
    setError('')
    try {
      await api('/v1/auth/logout', 'POST')
      router.replace('/sign-in')
      router.refresh()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <header className="aipollo-topbar">
      <Brand />
      {admin && <span className="badge badge-warning"><DesignIcon name="admin" /> Admin console</span>}
      {!admin && search.length > 0 && (
        <div className="app-search" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false)
        }} onKeyDown={event => { if (event.key === 'Escape') setSearchOpen(false) }}>
          <DesignIcon name="search" />
          <input type="search" aria-label="Search workspaces and sources"
            aria-controls={searchOpen && query.trim() ? searchId : undefined}
            placeholder={workspace ? text('Search workspaces, sources…', 'Tìm không gian, tài liệu…') : 'Search workspaces, sources…'} value={query}
            onFocus={() => setSearchOpen(true)} onChange={event => {
              setQuery(event.currentTarget.value)
              setSearchOpen(true)
            }} />
          {searchOpen && query.trim() && <ul id={searchId}>
            {matches.length ? matches.map(entry => (
              <li key={entry.href}><Link href={entry.href} onClick={event => {
                if (entry.documentId && onSelectSource && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  event.preventDefault()
                  onSelectSource(entry.documentId)
                }
                setQuery('')
                setSearchOpen(false)
              }}>
                <span>{entry.name}</span><span className="muted">{entry.kind}</span>
              </Link></li>
            )) : <li className="muted">No matching workspaces or sources.</li>}
          </ul>}
        </div>
      )}
      <nav className="aipollo-account" aria-label="Account navigation">
        {workspace && <WorkspaceLanguage />}
        {admin && <span className="badge badge-neutral admin-private"><DesignIcon name="private" /> Private document content is hidden</span>}
        {compact ? (
          <details className="account-popover">
            <summary aria-label="Account menu" className={admin ? 'admin-avatar' : undefined}>{avatar}</summary>
            <div>
              <Link href="/account">Account</Link>
              <button type="button" className="ghost sm" disabled={pending} onClick={signOut}>Sign out</button>
            </div>
          </details>
        ) : (
          <>
            <Link href="/account" className="button secondary sm">Account</Link>
            <button type="button" className="secondary sm" disabled={pending} onClick={signOut}>Sign out</button>
          </>
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
    </header>
  )
}
