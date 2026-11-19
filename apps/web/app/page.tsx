import Link from 'next/link'
import { BookOpen, Sparkles, Search, FileText, CheckCircle2, ArrowRight } from 'lucide-react'

export default function Home() {
  return (
    <main style={{ maxWidth: 'var(--container-wide)', marginInline: 'auto', padding: 'var(--space-page)' }}>
      <div className="hero-container">
        <header className="hero-banner">
          <div className="hero-badge">
            <Sparkles size={15} aria-hidden="true" />
            <span>Academic AI Research Workbench</span>
          </div>

          <h1>AIpollo</h1>

          <p className="hero-lead">
            Sign in to organize and share your academic workspaces. Verifiable multi-paper synthesis, structured planning, and direct citation navigation for researchers.
          </p>

          <div className="hero-actions actions">
            <Link className="button" href="/workspaces">
              <span>Open workspaces</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="button secondary" href="/register">
              Create an account
            </Link>
          </div>
        </header>

        <section aria-label="Key Capabilities" className="feature-grid">
          <article className="feature-card">
            <div className="feature-card-icon">
              <BookOpen size={20} aria-hidden="true" />
            </div>
            <h3>Bounded Corpus Grounding</h3>
            <p>
              Select exact research papers, preprints, and lab notes for each query. Prevent hallucinations with explicit source boundaries.
            </p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <CheckCircle2 size={20} aria-hidden="true" />
            </div>
            <h3>Verifiable Citations</h3>
            <p>
              Every claim links directly to its source document and exact PDF page number. Instant side-by-side inspection without losing context.
            </p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <h3>Plan-Before-Execution</h3>
            <p>
              Inspect, edit, or regenerate structured research plans before execution. Maintain full control over multi-step AI reasoning.
            </p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <FileText size={20} aria-hidden="true" />
            </div>
            <h3>Scholarly Synthesis</h3>
            <p>
              Export verifiable findings as Markdown or DOCX, manage DOI references, and collaborate securely across research teams.
            </p>
          </article>
        </section>
      </div>
    </main>
  )
}
