import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { GlobalLanguage } from './components/workspace-language'

export const metadata: Metadata = {
  title: 'AIpollo · Super Agentic RAG',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><GlobalLanguage />{children}</body>
    </html>
  )
}
