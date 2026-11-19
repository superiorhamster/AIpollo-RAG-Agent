'use client'

import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../lib/api'

export function ResetForm({ token }: { token?: string }) {
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
        await api('/v1/auth/password-reset/confirm', 'POST', { email, token, password: String(values.get('password')) })
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
  if (sent) return <p role="status">{token ? 'Password changed. Sign in with your new password.'
    : 'If this address can receive a reset link, check your email.'}</p>
  return <form className="form-stack" onSubmit={submit}>
    <label>Email<input type="email" name="email" required autoComplete="email" /></label>
    {token && <label>New password<input type="password" name="password" required minLength={8}
      maxLength={128} autoComplete="new-password" /></label>}
    {error && <p role="alert">{error}</p>}
    <button disabled={pending}>{token ? 'Update password' : 'Send reset link'}</button>
  </form>
}
