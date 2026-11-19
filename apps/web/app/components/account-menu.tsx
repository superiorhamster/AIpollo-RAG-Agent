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
      <Link className="brand" href="/workspaces">Super Agentic RAG</Link>
      <nav aria-label="Account navigation">
        <Link href="/account">Account</Link>
        <button type="button" className="secondary" disabled={pending} onClick={signOut}>Sign out</button>
      </nav>
      {error && <p role="alert">{error}</p>}
    </header>
  )
}
