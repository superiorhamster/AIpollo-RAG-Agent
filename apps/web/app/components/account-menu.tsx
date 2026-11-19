'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'

export function AccountMenu() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

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
    <header className="topbar">
      <Link className="brand" href="/workspaces">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
        <span>Super Agentic RAG</span>
      </Link>
      <nav aria-label="Account navigation">
        <Link href="/account">Account</Link>
        <button type="button" className="secondary" disabled={pending} onClick={signOut}>
          Sign out
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
    </header>
  )
}
