import Link from 'next/link'
import { Localized } from './workspace-language'
import type { ReactNode } from 'react'

export type IconName =
  | 'feature-shield' | 'feature-plan' | 'feature-book' | 'mail' | 'lock'
  | 'policy-shield' | 'search' | 'upload' | 'upload-drop' | 'error'
  | 'chats' | 'chats-active' | 'library' | 'library-active' | 'notes' | 'artifacts' | 'artifacts-active'
  | 'references' | 'history' | 'folder' | 'folder-active' | 'file' | 'paper-tab' | 'panel'
  | 'chevron-left' | 'chevron-right' | 'minus' | 'plus' | 'annotate'
  | 'ask' | 'plan' | 'agent' | 'assistant' | 'send' | 'source-count' | 'approval-lock' | 'warning'
  | 'step-completed' | 'step-running' | 'clock' | 'citation'
  | 'admin' | 'private' | 'overview' | 'overview-active' | 'users' | 'users-active'
  | 'jobs' | 'configuration' | 'configuration-lock' | 'logout'

export function DesignIcon({ name }: { name: IconName }) {
  return <img className="design-icon" src={'/aipollo/' + name + '.svg'} alt="" />
}

export function Brand({ href = '/workspaces' }: { href?: string }) {
  return (
    <Link className="aipollo-brand" href={href}>
      <span className="aipollo-mark"><img src="/aipollo/logo.png" alt="" /></span>
      <span>AIpollo</span>
    </Link>
  )
}

const features = [
  ['feature-shield', 'Grounded answers', 'Every claim links to the exact page and passage.'],
  ['feature-plan', 'Plan before the agent acts', 'Review, edit and Accept. Nothing runs before you approve.'],
  ['feature-book', 'Learn · Research · Write', 'Quizzes, flashcards, evidence tables and cited drafts.'],
] as const

const featureTranslations: Record<string, [string, string]> = {
  'feature-shield': ['Dựa trên nguồn tài liệu', 'Đọc câu trả lời cùng các trích dẫn có thể kiểm chứng.'],
  'feature-plan': ['Duyệt kế hoạch trước khi chạy', 'Xem và chỉnh sửa kế hoạch. Chỉ thực hiện sau khi bạn chấp nhận.'],
  'feature-book': ['Học · Nghiên cứu · Viết', 'Câu hỏi ôn tập, thẻ ghi nhớ, bảng bằng chứng và bản nháp có trích dẫn.'],
}

export function AuthLayout({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="auth-brand">
        <Link className="auth-wordmark" href="/">AIpollo</Link>
        <img src="/aipollo/logo.png" alt="" width={114} height={114} />
        <p className="auth-headline"><Localized en="Your academic knowledge workspace." vi="Không gian tri thức học thuật của bạn." /></p>
        <p className="auth-description"><Localized en="Learn from course materials, review literature, and write with citations you can verify." vi="Học từ tài liệu, nghiên cứu tổng quan và viết với các trích dẫn có thể kiểm chứng." /></p>
        <ul className="auth-features">
          {features.map(([icon, title, detail]) => (
            <li key={icon}>
              <span className="auth-feature-icon"><DesignIcon name={icon} /></span>
              <div><strong><Localized en={title} vi={featureTranslations[icon][0]} /></strong><p><Localized en={detail} vi={featureTranslations[icon][1]} /></p></div>
            </li>
          ))}
        </ul>
      </aside>
      <div className="auth-form-area">
        <section className="auth-card">{children}</section>
        {note && <p className="auth-session-note">{note}</p>}
      </div>
    </main>
  )
}
