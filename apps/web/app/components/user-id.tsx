'use client'

import { useRef, useState } from 'react'

export function UserId({ value }: { value: string }) {
  const field = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setMessage('User ID copied.')
    } catch {
      field.current?.select()
      setMessage('User ID selected for copying.')
    }
  }

  return (
    <div className="form-stack">
      <label>
        User ID
        <input
          ref={field}
          value={value}
          readOnly
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', letterSpacing: '0.02em' }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="secondary sm" type="button" onClick={copy}>
          Copy user ID
        </button>
        {message && <span role="status" className="muted">{message}</span>}
      </div>
    </div>
  )
}
