import { Localized } from '../components/workspace-language'
import Link from 'next/link'
import { ArrowLeft, User, Shield, ExternalLink } from 'lucide-react'
import { AccountMenu } from '../components/account-menu'
import { UserId } from '../components/user-id'
import type { Account } from '../lib/api'
import { signedInRequest } from '../lib/gateway'

export default async function AccountPage() {
  const account = await signedInRequest<Account>('/v1/auth/me', '/account')
  const isAdmin = account.role === 'ADMIN'

  return (
    <>
      <AccountMenu email={account.email} />
      <main className="account-shell">
        <div style={{ marginBottom: '1.25rem' }}>
          <Link
            href="/workspaces"
            prefetch={false}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span><Localized en="Back to workspaces" vi="Về không gian làm việc"/></span>
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h1><Localized en="Account" vi="Tài khoản"/></h1>
          <span className={`badge ${isAdmin ? 'badge-primary' : 'badge-neutral'}`}>
            {isAdmin ? <Shield size={13} aria-hidden="true" /> : <User size={13} aria-hidden="true" />}
            <span>{isAdmin ? <Localized en="Administrator" vi="Quản trị viên"/> : <Localized en="Researcher" vi="Người nghiên cứu"/>}</span>
          </span>
        </div>

        <div className="panel form-stack">
          <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--line)' }}>
            <p style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--ink)' }}>{account.email}</p>
            <p className="muted" style={{ marginTop: '0.2rem' }}>
              {isAdmin ? <Localized en="Platform administrator" vi="Quản trị viên hệ thống"/> : <Localized en="Platform research user" vi="Người dùng nghiên cứu"/>}
            </p>
          </div>

          <UserId value={account.user_id} />

          {isAdmin && (
            <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--line)' }}>
              <Link
                href="/admin"
                className="button secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', width: 'fit-content', textDecoration: 'none' }}
              >
                <Shield size={16} aria-hidden="true" />
                <span><Localized en="Administration" vi="Quản trị"/></span>
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
