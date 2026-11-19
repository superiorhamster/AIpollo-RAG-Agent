'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ApiError, RenewalUnconfirmed, renewSession } from '../../lib/api'

export function RenewSession({ returnTo }: { returnTo: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    renewSession().then(
      () => { if (active) window.location.replace(returnTo) },
      error => {
        if (!active) return
        if (error instanceof ApiError && error.status === 401 && !(error instanceof RenewalUnconfirmed)) {
          window.location.replace('/sign-in')
        } else {
          setFailed(true)
        }
      },
    )
    return () => { active = false }
  }, [returnTo])

  return (
    <main className="account-shell">
      {failed
        ? <p role="alert">Could not renew your session. <Link href="/sign-in">Sign in again</Link>.</p>
        : <p role="status">Checking your session…</p>}
    </main>
  )
}
