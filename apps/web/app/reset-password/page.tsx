import { Localized } from '../components/workspace-language'
import Link from 'next/link'
import { AuthLayout } from '../components/aipollo'
import { ResetForm } from './reset-form'

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const valid = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined

  return (
    <AuthLayout>
      <header className="auth-card-heading"><h1><Localized en="Reset password" vi="Đặt lại mật khẩu"/></h1></header>
      <div className="form-stack"><ResetForm token={valid} /></div>
      <Link href="/sign-in"><Localized en="Back to sign in" vi="Về trang đăng nhập" /></Link>
    </AuthLayout>
  )
}
