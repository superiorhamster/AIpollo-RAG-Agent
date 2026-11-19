'use client'

export function LoadError({ reset }: { reset: () => void }) {
  return (
    <main className="account-shell">
      <div className="panel form-stack">
        <span className="badge badge-danger">Connection Error</span>
        <h1>Could not load this page</h1>
        <p className="muted">The service may be restarting or momentarily unreachable.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  )
}
