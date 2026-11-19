import Link from 'next/link'
import { AccountMenu } from '../components/account-menu'
import { UserId } from '../components/user-id'
import type { Account } from '../lib/api'
import { signedInRequest } from '../lib/gateway'

export default async function AccountPage() {
  const account = await signedInRequest<Account>('/v1/auth/me', '/account')
  const isAdmin = account.role === 'ADMIN'

  return (
    <>
      <AccountMenu />
      <main className="account-shell">
        <div style={{ marginBottom: '1rem' }}>
          <Link href="/workspaces" prefetch={false} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span aria-hidden="true">&larr;</span> Back to workspaces
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h1>Account</h1>
          <span className={`badge ${isAdmin ? 'badge-primary' : 'badge-neutral'}`}>
            {isAdmin ? 'Administrator' : 'Researcher'}
          </span>
        </div>

        <div className="panel form-stack">
          <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--line)' }}>
            <p style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--ink)' }}>{account.email}</p>
            <p className="muted" style={{ marginTop: '0.2rem' }}>
              {isAdmin ? 'Platform administrator' : 'Platform user'}
            </p>
          </div>

          <UserId value={account.user_id} />

          {isAdmin && (
            <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--line)' }}>
              <Link
                href="/admin"
                className="button secondary"
                style={{ display: 'inline-flex', width: 'fit-content', textDecoration: 'none' }}
              >
                Administration
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
