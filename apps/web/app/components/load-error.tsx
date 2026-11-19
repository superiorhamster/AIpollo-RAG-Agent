'use client'

export function LoadError({ reset }: { reset: () => void }) {
  return (
    <main className="account-shell">
      <h1>Could not load this page</h1>
      <p>The service may be restarting.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  )
}
