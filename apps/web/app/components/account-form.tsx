'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { AuthLayout, DesignIcon } from './aipollo'
import { useWorkspaceLanguage } from './workspace-language'
import { api, ApiError, errorMessage } from '../lib/api'

const passwordPattern = String.raw`(?=.*[A-Z])(?=.*[0-9])(?=.*[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]).{8,128}`
const passwordRule = 'Use at least 8 characters, including an uppercase letter, a number, and a special character.'

export function AccountForm({ register, renewalUnconfirmed = false, registered = false }: {
  register: boolean
  registered?: boolean
  renewalUnconfirmed?: boolean
}) {
  const router = useRouter()
  const { text } = useWorkspaceLanguage()
  const [password, setPassword] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (!retryAt) return
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const credentials = { email: form.get('email'), password: form.get('password') }
    if (register && form.get('password') !== form.get('confirm-password')) {
      setError(text('Passwords do not match.', 'Mật khẩu xác nhận không khớp.'))
      setPending(false)
      return
    }
    try {
      await api(register ? '/v1/auth/register' : '/v1/auth/login', 'POST', credentials)
      router.replace(register ? '/sign-in?registered=1' : '/workspaces')
      router.refresh()
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 429
        ? text('Too many attempts. Wait before trying again.', 'Quá nhiều lần thử. Vui lòng chờ trước khi thử lại.') : errorMessage(failure))
      if (failure instanceof ApiError && failure.retryAfter) {
        setRetryAt(Date.now() + failure.retryAfter * 1000)
        setRemaining(failure.retryAfter)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout note={text('Secure access to your academic workspace.', 'Truy cập an toàn vào không gian học thuật.')}>
      <nav className="auth-tabs" aria-label="Authentication">
        <Link href="/sign-in" aria-current={register ? undefined : 'page'}>{text('Sign in', 'Đăng nhập')}</Link>
        <Link href="/register" aria-current={register ? 'page' : undefined}>{text('Register', 'Đăng ký')}</Link>
      </nav>

      <header className="auth-card-heading">
        <h1>{register ? text('Create an account', 'Tạo tài khoản') : text('Welcome back', 'Chào mừng trở lại')}</h1>
        <p>{register ? text('Set up your academic workspace', 'Tạo không gian học tập của bạn') : text('Sign in to your workspace', 'Đăng nhập vào không gian làm việc')}</p>
      </header>

      {registered && <p role="status">{text('Account created. Sign in to continue.', 'Tạo tài khoản thành công. Đăng nhập để tiếp tục.')}</p>}
      {renewalUnconfirmed && <p role="alert">Could not confirm session renewal. Sign in again.</p>}

      <form className="auth-form" method="post" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="auth-email">Email</label>
          <div className="auth-input">
            <DesignIcon name="mail" />
            <input id="auth-email" name="email" type="email" autoComplete="email"
              maxLength={254} required placeholder="@mail.com" />
          </div>
        </div>
        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="auth-password">{text('Password', 'Mật khẩu')}</label>
            {!register && <Link href="/reset-password">{text('Forgot password?', 'Quên mật khẩu?')}</Link>}
          </div>
          <div className="auth-input">
            <DesignIcon name="lock" />
            <input
              id="auth-password"
              name="password"
              type="password"
              onChange={event => setPassword(event.currentTarget.value)}
              maxLength={128}
              minLength={register ? 8 : 1}
              pattern={register ? passwordPattern : undefined}
              title={register ? passwordRule : undefined}
              autoComplete={register ? 'new-password' : 'current-password'}
              aria-describedby={register ? 'password-rule' : undefined}
              required
              placeholder="••••••••••"
            />
          </div>
        </div>

        {register && <>
          <label htmlFor="confirm-password">{text('Confirm password', 'Nhập lại mật khẩu')}</label>
          <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" required maxLength={128} />
          <ul className="password-checks" id="password-rule" aria-label={text('Password requirements', 'Yêu cầu mật khẩu')}>
            {[
              [password.length >= 8 && password.length <= 128, text('8–128 characters', '8–128 ký tự')],
              [/[A-Z]/.test(password), text('At least one uppercase letter', 'Ít nhất một chữ hoa')],
              [/[0-9]/.test(password), text('At least one number', 'Ít nhất một chữ số')],
              [/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(password), text('At least one special character', 'Ít nhất một ký tự đặc biệt')],
            ].map(([met, label]) => <li key={String(label)} data-met={Boolean(met)}><span aria-hidden="true">{met ? '✓' : '○'}</span> {label}</li>)}
          </ul>
        </>}
        {error && <p role="alert"><AlertCircle size={16} aria-hidden="true" /> {error}</p>}

        {remaining > 0 && <p role="status">{text('Try again in', 'Thử lại sau')} {remaining} {text('seconds.', 'giây.')}</p>}
        <button type="submit" disabled={pending || remaining > 0}>{register ? text('Create account', 'Tạo tài khoản') : text('Sign in', 'Đăng nhập')}</button>
      </form>

      <div className="auth-policy">
        <DesignIcon name="policy-shield" />
        <p>{text('Registration creates a User account only. Roles are assigned server-side; Admin accounts are provisioned by administrators. Failed attempts are rate-limited.', 'Đăng ký chỉ tạo tài khoản Người dùng. Quyền Quản trị viên do quản trị viên cấp. Số lần thử bị giới hạn để bảo vệ tài khoản.')}</p>
      </div>
    </AuthLayout>
  )
}
