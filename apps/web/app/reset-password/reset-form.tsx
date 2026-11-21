'use client'

import { useState, type FormEvent } from 'react'
import { useWorkspaceLanguage } from '../components/workspace-language'
import { api, errorMessage } from '../lib/api'

export function ResetForm({ token }: { token?: string }) {
  const { text } = useWorkspaceLanguage()
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const email = String(values.get('email'))
      if (token) {
        await api('/v1/auth/password-reset/confirm', 'POST', {
          email,
          token,
          password: String(values.get('password')),
        })
        window.history.replaceState(null, '', '/reset-password')
      } else {
        await api('/v1/auth/password-reset', 'POST', { email })
      }
      setSent(true)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <span className="badge badge-success">{text('Request processed', 'Đã xử lý yêu cầu')}</span>
        <p role="status">
          {token
            ? text('Password changed. Sign in with your new password.', 'Đã đổi mật khẩu. Đăng nhập bằng mật khẩu mới.')
            : text('If this address can receive a reset link, check your email.', 'Nếu địa chỉ này có thể nhận liên kết đặt lại mật khẩu, vui lòng kiểm tra email.')}
        </p>
      </div>
    )
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="scholar@university.edu"
        />
      </label>

      {token && (
        <label>
          {text('New password', 'Mật khẩu mới')}
          <input
            type="password"
            name="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </label>
      )}

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={pending}>
        {token ? text('Update password', 'Cập nhật mật khẩu') : text('Send reset link', 'Gửi liên kết đặt lại')}
      </button>
    </form>
  )
}
