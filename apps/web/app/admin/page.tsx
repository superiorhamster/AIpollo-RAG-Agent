import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AccountMenu } from '../components/account-menu'
import { signedInRequest } from '../lib/gateway'
import type { Account } from '../lib/api'
import { AdminPanel } from './admin-panel'

export default async function AdminPage() {
  const account = await signedInRequest<Account>('/v1/auth/me', '/admin')
  if (account.role !== 'ADMIN') notFound()

  return (
    <>
      <AccountMenu />
      <main className="document-page">
        <div style={{ marginBottom: '1.25rem' }}>
          <Link href="/account" prefetch={false} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span aria-hidden="true">&larr;</span> Back to account
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
            <h1>Administration</h1>
            <span className="badge badge-primary">Superuser Console</span>
          </div>
          <p className="muted">Manage platform accounts, monitor background processing jobs, inspect audit logs, and verify service health.</p>
        </div>
        <AdminPanel />
      </main>
    </>
  )
}
