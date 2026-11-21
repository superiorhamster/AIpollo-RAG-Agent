import { Localized } from './components/workspace-language'
import Link from 'next/link'
import { BookOpen, Sparkles, Search, FileText, CheckCircle2, ArrowRight } from 'lucide-react'

export default function Home() {
  return (
    <main style={{ maxWidth: 'var(--container-wide)', marginInline: 'auto', padding: 'var(--space-page)' }}>
      <div className="hero-container">
        <header className="hero-banner">
          <div className="hero-badge">
            <Sparkles size={15} aria-hidden="true" />
            <span><Localized en="Academic AI Research Workbench" vi="Không gian nghiên cứu học thuật với AI"/></span>
          </div>

          <h1><Localized en="AIpollo" vi="AIpollo"/></h1>

          <p className="hero-lead"><Localized en="Sign in to organize and share your academic workspaces. Verifiable multi-paper synthesis, structured planning, and direct citation navigation for researchers." vi="Đăng nhập để tổ chức và chia sẻ tài liệu học thuật, tổng hợp nhiều nguồn và kiểm chứng trích dẫn trực tiếp."/></p>

          <div className="hero-actions actions"><Link className="button secondary" href="/sign-in"><Localized en="Sign in" vi="Đăng nhập" /></Link>
            <Link className="button" href="/workspaces">
              <span><Localized en="Open workspaces" vi="Mở không gian làm việc"/></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="button secondary" href="/register"><Localized en="Create an account" vi="Tạo tài khoản"/></Link>
          </div>
        </header>

        <section aria-label="Key Capabilities" className="feature-grid">
          <article className="feature-card">
            <div className="feature-card-icon">
              <BookOpen size={20} aria-hidden="true" />
            </div>
            <h3><Localized en="Bounded Corpus Grounding" vi="Câu trả lời dựa trên nguồn đã chọn"/></h3>
            <p><Localized en="Select exact research papers, preprints, and lab notes for each query. Prevent hallucinations with explicit source boundaries." vi="Chọn chính xác bài báo và ghi chú cho từng câu hỏi; câu trả lời chỉ sử dụng các nguồn được chọn."/></p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <CheckCircle2 size={20} aria-hidden="true" />
            </div>
            <h3><Localized en="Verifiable Citations" vi="Trích dẫn có thể kiểm chứng"/></h3>
            <p><Localized en="Every claim links directly to its source document and exact PDF page number. Instant side-by-side inspection without losing context." vi="Mỗi nhận định có liên kết tới tài liệu và trang PDF để kiểm tra song song."/></p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <h3><Localized en="Plan-Before-Execution" vi="Duyệt kế hoạch trước khi thực hiện"/></h3>
            <p><Localized en="Inspect, edit, or regenerate structured research plans before execution. Maintain full control over multi-step AI reasoning." vi="Xem, chỉnh sửa hoặc tạo lại kế hoạch nghiên cứu trước khi cho phép thực hiện."/></p>
          </article>

          <article className="feature-card">
            <div className="feature-card-icon">
              <FileText size={20} aria-hidden="true" />
            </div>
            <h3><Localized en="Scholarly Synthesis" vi="Tổng hợp học thuật" /></h3>
            <p>
              <Localized en="Export verifiable findings as Markdown or DOCX, manage DOI references, and collaborate securely across research teams." vi="Xuất kết quả có thể kiểm chứng sang Markdown hoặc DOCX, quản lý tài liệu DOI và cộng tác an toàn." />
            </p>
          </article>
        </section>
      </div>
    </main>
  )
}
