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
      <AccountMenu email={account.email} compact admin />
      <main className="admin-page"><AdminPanel currentUser={account.user_id} /></main>
    </>
  )
}
