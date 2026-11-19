'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
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
    <main className="account-shell">
      <Link className="brand" href="/">Super Agentic RAG</Link>
      <h1>{register ? 'Create an account' : 'Sign in'}</h1>
      {renewalUnconfirmed && <p role="alert">Could not confirm session renewal. Sign in again.</p>}
      <form className="panel form-stack" method="post" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <label>
          Password
          <input name="password" type="password" maxLength={128} minLength={register ? 8 : 1}
            pattern={register ? passwordPattern : undefined} title={register ? passwordRule : undefined}
            autoComplete={register ? 'new-password' : 'current-password'} aria-describedby={register ? 'password-rule' : undefined}
            required />
        </label>
        {register && <p className="muted" id="password-rule">{passwordRule}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{register ? 'Create account' : 'Sign in'}</button>
      </form>
      <p>{register ? <Link href="/sign-in">Sign in instead</Link> : <Link href="/register">Create an account</Link>}</p>
    </main>
  )
}
