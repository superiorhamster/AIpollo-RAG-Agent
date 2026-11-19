import Link from 'next/link'
import { AuthLayout } from '../components/aipollo'
import { ResetForm } from './reset-form'

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined

  return (
    <AuthLayout>
      <header className="auth-card-heading"><h1>Reset password</h1></header>
      <div className="form-stack"><ResetForm token={valid} /></div>
      <Link href="/sign-in">Back to sign in</Link>
    </AuthLayout>
  )
}
