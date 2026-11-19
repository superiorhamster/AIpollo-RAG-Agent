'use client'

import { useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function UserId({ value }: { value: string }) {
  const field = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setMessage('User ID copied.')
      setTimeout(() => setCopied(false), 2000)
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
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', letterSpacing: '0.02em', background: 'var(--surface-subtle)' }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="secondary sm" type="button" onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>Copy user ID</span>
        </button>
        {message && <span role="status" className="muted" style={{ fontSize: '0.82rem' }}>{message}</span>}
      </div>
    </div>
  )
}
