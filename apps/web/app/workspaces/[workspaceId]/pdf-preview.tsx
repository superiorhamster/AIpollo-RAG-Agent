'use client'
import dynamic from 'next/dynamic'
export type Region = [number, number, number, number]
export type CitationTarget = {
  document_id: string
  page: number
  name?: string
  region?: Region | null
  regions?: Region[] | null
  citation_id?: string | null
  segment_ids?: string[] | null
  precision?: 'line' | 'coarse' | 'page' | null
  text?: string
}
export type PdfPreviewProps = {
  url: string
  annotationsUrl: string
  page: number
  onPage: (page: number) => void
  onPendingChange?: (pending: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
  citationRegion?: Region
  citationRegions?: Region[] | null
  onClearCitation?: () => void
}
const Reader = dynamic(() => import('./embed-pdf-reader'), {
  ssr: false,
  loading: () => <p role="status">Loading preview…</p>
})
export function PdfPreview(props: PdfPreviewProps) {
  return <Reader key={props.url} {...props} />
}
