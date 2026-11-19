import Link from 'next/link'
import { ResetForm } from './reset-form'

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined
  return <main className="account-shell">
    <h1>Reset password</h1>
    <ResetForm token={valid} />
    <Link href="/sign-in">Back to sign in</Link>
  </main>
}
