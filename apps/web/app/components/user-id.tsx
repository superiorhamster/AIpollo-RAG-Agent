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
      <label>User ID<input ref={field} value={value} readOnly /></label>
      <button className="secondary" type="button" onClick={copy}>Copy user ID</button>
      <p role="status" className="muted">{message}</p>
    </div>
  )
}
