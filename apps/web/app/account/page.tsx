import Link from 'next/link'
import { AccountMenu } from '../components/account-menu'
import { UserId } from '../components/user-id'
import type { Account } from '../lib/api'
import { signedInRequest } from '../lib/gateway'

export default async function AccountPage() {
  const account = await signedInRequest<Account>('/v1/auth/me', '/account')
  return (
    <>
      <AccountMenu />
      <main className="account-shell">
        <Link href="/workspaces" prefetch={false}>Back to workspaces</Link>
        <h1>Account</h1>
        <div className="panel form-stack">
          <p>{account.email}</p>
          <p className="muted">{account.role === 'ADMIN' ? 'Platform administrator' : 'Platform user'}</p>
          <UserId value={account.user_id} />
          {account.role === 'ADMIN' && <Link href="/admin">Administration</Link>}
        </div>
      </main>
    </>
  )
}
