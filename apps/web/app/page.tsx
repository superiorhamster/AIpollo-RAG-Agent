import Link from 'next/link'

export default function Home() {
  return (
    <main className="account-shell">
      <h1>Super Agentic RAG</h1>
      <p>Sign in to organize and share your academic workspaces.</p>
      <div className="actions">
        <Link className="button" href="/workspaces">Open workspaces</Link>
        <Link href="/register">Create an account</Link>
      </div>
    </main>
  )
}
