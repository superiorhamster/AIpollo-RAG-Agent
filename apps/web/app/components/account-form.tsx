'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { AuthLayout, DesignIcon } from './aipollo'
import { api, errorMessage } from '../lib/api'

const passwordPattern = String.raw`(?=.*[A-Z])(?=.*[0-9])(?=.*[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]).{8,128}`
const passwordRule = 'Use at least 8 characters, including an uppercase letter, a number, and a special character.'

export function AccountForm({ register, renewalUnconfirmed = false }: {
  register: boolean
  renewalUnconfirmed?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const credentials = { email: form.get('email'), password: form.get('password') }
    try {
      await api(register ? '/v1/auth/register' : '/v1/auth/login', 'POST', credentials)
      router.replace(register ? '/sign-in' : '/workspaces')
      router.refresh()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout note="Session: short-lived access token · revocable refresh token">
      <nav className="auth-tabs" aria-label="Authentication">
        <Link href="/sign-in" aria-current={register ? undefined : 'page'}>Sign in</Link>
        <Link href="/register" aria-current={register ? 'page' : undefined}>Register</Link>
      </nav>

      <header className="auth-card-heading">
        <h1>{register ? 'Create an account' : 'Welcome back'}</h1>
        <p>{register ? 'Set up your academic workspace' : 'Sign in to your workspace'}</p>
      </header>

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
            <label htmlFor="auth-password">Password</label>
            {!register && <Link href="/reset-password">Forgot password?</Link>}
          </div>
          <div className="auth-input">
            <DesignIcon name="lock" />
            <input
              id="auth-password"
              name="password"
              type="password"
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

        {register && <p className="muted" id="password-rule">{passwordRule}</p>}
        {error && <p role="alert"><AlertCircle size={16} aria-hidden="true" /> {error}</p>}

        <button type="submit" disabled={pending}>{register ? 'Create account' : 'Sign in'}</button>
      </form>

      <div className="auth-policy">
        <DesignIcon name="policy-shield" />
        <p>Registration creates a User account only. Roles are assigned server-side; Admin accounts are provisioned by administrators. Failed attempts are rate-limited.</p>
      </div>
    </AuthLayout>
  )
}
