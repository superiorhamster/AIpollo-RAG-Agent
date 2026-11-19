import Link from 'next/link'
import { ResetForm } from './reset-form'

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined

  return (
    <main className="account-shell">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link className="brand" href="/">Super Agentic RAG</Link>
        <p className="muted" style={{ marginTop: '0.25rem' }}>Account Recovery</p>
      </div>

      <h1>Reset password</h1>

      <div className="panel form-stack">
        <ResetForm token={valid} />
      </div>

      <p style={{ marginTop: '1.25rem' }}>
        <Link href="/sign-in">&larr; Back to sign in</Link>
      </p>
    </main>
  )
}
