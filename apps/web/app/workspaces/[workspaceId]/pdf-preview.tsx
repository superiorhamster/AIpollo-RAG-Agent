'use client'

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import { DesignIcon } from '../../components/aipollo'
import { authenticatedFetch, readResponse } from '../../lib/api'

export type Region = [number, number, number, number]
export type CitationTarget = { document_id: string; page: number; region?: Region | null; regions?: Region[] | null;
  citation_id?: string | null; segment_ids?: string[] | null; precision?: 'line' | 'coarse' | 'page' | null; text?: string }

export function PdfPreview({ url, page, onPage, regions = [], citationRegion, citationRegions, onRegion, onClearCitation }: {
  url: string
  page: number
  onPage: (page: number) => void
  regions?: Region[]
  citationRegion?: Region
  citationRegions?: Region[] | null
  onRegion?: (region: Region, page: number) => void
  onClearCitation?: () => void
}) {
  const { text } = useWorkspaceLanguage()
  const [pageInput, setPageInput] = useState(String(page))
  const [pageError, setPageError] = useState(false)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [loadError, setLoadError] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [renderedPage, setRenderedPage] = useState<number>()
  const [findOpen, setFindOpen] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findResult, setFindResult] = useState('')
  const lastMatch = useRef<{ query: string; page: number }>(undefined)
  const start = useRef<[number, number] | undefined>(undefined)
  const canvas = useRef<HTMLCanvasElement>(null)
  const citationBoxes = citationRegions?.length ? citationRegions : citationRegion ? [citationRegion] : []
  const citationMark = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let active = true
    let task: PDFDocumentLoadingTask | undefined
    async function load() {
      const probe = await authenticatedFetch(url, { method: 'HEAD' })
      if (!probe.ok) await readResponse(probe)
      if (!active) return
      const pdfjs = await import('pdfjs-dist')
      if (!active) return
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
      task = pdfjs.getDocument({
        url, enableXfa: false, cMapPacked: true,
        cMapUrl: '/pdfjs/cmaps/', standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
      })
      const document = await task.promise
      if (active) setPdf(document)
    }
    void load().catch(() => { if (active) setLoadError(true) })
    return () => {
      active = false
      void task?.destroy().catch(() => {})
    }
  }, [url, attempt])

  const pageNumber = pdf ? Math.min(page, pdf.numPages) : page
  useEffect(() => { setPageInput(String(pageNumber)); setPageError(false) }, [pageNumber])
  useEffect(() => {
    if (!pdf) return
    const document = pdf
    const target = canvas.current
    if (!target) return
    const targetCanvas = target
    let active = true
    let task: RenderTask | undefined
    async function renderPage() {
      const source = await document.getPage(pageNumber)
      if (!active) return
      const original = source.getViewport({ scale: 1 })
      const scale = Math.min(2, 1120 / original.width, 1500 / original.height)
      const viewport = source.getViewport({ scale })
      targetCanvas.width = Math.ceil(viewport.width)
      targetCanvas.height = Math.ceil(viewport.height)
      task = source.render({ canvas: targetCanvas, viewport })
      await task.promise
      if (active) setRenderedPage(pageNumber)
    }
    void renderPage().catch(() => { if (active) setRenderError(true) })
    return () => {
      active = false
      task?.cancel()
    }
  }, [pdf, pageNumber])

  useEffect(() => {
    const target = citationMark.current
    if (target && pdf && renderedPage === pageNumber) {
      const frame = requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
      return () => cancelAnimationFrame(frame)
    }
  }, [citationRegion, citationRegions, pdf, pageNumber, renderedPage])

  async function findText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pdf || finding) return
    const query = String(new FormData(event.currentTarget).get('find')).trim().normalize().toLocaleLowerCase()
    if (!query) return
    setFinding(true)
    setFindResult('')
    const firstPage = lastMatch.current?.query === query && lastMatch.current.page === pageNumber
      ? pageNumber % pdf.numPages + 1 : pageNumber
    try {
      for (let offset = 0; offset < pdf.numPages; offset++) {
        const next = (firstPage - 1 + offset) % pdf.numPages + 1
        const content = await (await pdf.getPage(next)).getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str : '').join(' ')
          .normalize().toLocaleLowerCase().replace(/\s+/g, ' ')
        if (text.includes(query.replace(/\s+/g, ' '))) {
          lastMatch.current = { query, page: next }
          onPage(next)
          setFindResult('Match on page ' + next)
          return
        }
      }
      setFindResult('No matching text found in this PDF.')
    } catch {
      setFindResult('Could not search text in this PDF.')
    } finally {
      setFinding(false)
    }
  }

  function relative(event: PointerEvent<HTMLDivElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    return [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)]
  }

  if (loadError || renderError) {
    return (
      <div role="alert" className="form-stack">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertCircle size={16} aria-hidden="true" />
          <p style={{ margin: 0 }}>Could not display this PDF.</p>
        </div>
        <button
          type="button"
          className="secondary sm"
          onClick={() => {
            setPdf(undefined)
            setLoadError(false)
            setRenderError(false)
            setAttempt(value => value + 1)
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <RefreshCw size={13} aria-hidden="true" />
          <span>Try preview again</span>
        </button>
      </div>
    )
  }

  return (
    <>
      {pdf ? (
        <div className="pdf-controls">
          <button type="button" aria-label="Previous page" disabled={pageNumber === 1}
            onClick={() => onPage(pageNumber - 1)}><DesignIcon name="chevron-left" /></button>
          <form className="pdf-page-jump" onSubmit={event => {
            event.preventDefault()
            const next = Number(pageInput)
            if (!Number.isSafeInteger(next) || next < 1 || next > pdf.numPages) { setPageError(true); return }
            setPageError(false)
            onPage(next)
          }}>
            <span aria-live="polite">{text('Page', 'Trang')} {pageNumber} {text('of', 'trên')} {pdf.numPages}</span>
            <input type="number" inputMode="numeric" aria-label={text('Page number', 'Số trang')}
              min={1} max={pdf.numPages} value={pageInput} onChange={event => setPageInput(event.currentTarget.value)} />
            <button type="submit">{text('Go', 'Đi')}</button>
          </form>
          <button type="button" aria-label="Next page" disabled={pageNumber === pdf.numPages}
            onClick={() => onPage(pageNumber + 1)}><DesignIcon name="chevron-right" /></button>
          <div className="pdf-zoom">
            <button type="button" aria-label="Zoom out" disabled={zoom <= 50}
              onClick={() => setZoom(value => value - 25)}><DesignIcon name="minus" /></button>
            <button type="button" aria-label="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
            <button type="button" aria-label="Zoom in" disabled={zoom >= 200}
              onClick={() => setZoom(value => value + 25)}><DesignIcon name="plus" /></button>
            <button type="button" aria-label="Find in PDF" aria-expanded={findOpen}
              onClick={() => setFindOpen(value => !value)}><DesignIcon name="search" /></button>
          </div>
        </div>
      ) : (
        <p role="status">Loading preview…</p>
      )}
      {pageError && <p role="alert">{text('Enter a valid page number.', 'Nhập số trang hợp lệ.')}</p>}
      {citationBoxes.length > 0 && onClearCitation && <button type="button" className="secondary sm" onClick={onClearCitation}>{text('Clear highlight', 'Bỏ tô sáng trích dẫn')}</button>}
      {pdf && findOpen && <form className="reader-find" onSubmit={findText}>
        <input type="search" name="find" aria-label="Text to find" placeholder="Find text in the PDF…" required disabled={finding} autoFocus />
        <button type="submit" className="secondary sm" disabled={finding}>{finding ? 'Finding…' : 'Find next'}</button>
        {findResult && <p role="status">{findResult}</p>}
      </form>}
      <div className="pdf-paper" hidden={!pdf} tabIndex={0} role="region" aria-label={text('Scrollable PDF page', 'Trang PDF có thể cuộn')}>
        <div className="pdf-stage" style={{ width: zoom + '%' }}>
        <canvas ref={canvas} role="img" aria-label={'PDF page ' + pageNumber} />
        {citationBoxes.map(([left, top, right, bottom], index) => (
          <span className="pdf-highlight citation-highlight" role="mark" aria-label="Citation highlight"
            key={index} ref={index === 0 ? citationMark : undefined} style={{
              left: left * 100 + '%', top: top * 100 + '%',
              width: (right - left) * 100 + '%', height: (bottom - top) * 100 + '%',
            }} />
        ))}
        {regions.map(([left, top, right, bottom], index) => (
          <span
            key={index}
            className="pdf-highlight"
            style={{
              left: left * 100 + '%',
              top: top * 100 + '%',
              width: (right - left) * 100 + '%',
              height: (bottom - top) * 100 + '%',
            }}
          />
        ))}
        {onRegion && (
          <div
            className="pdf-selection"
            onPointerDown={event => {
              if (event.button !== 0) return
              start.current = relative(event)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerCancel={() => { start.current = undefined }}
            onPointerUp={event => {
              if (!start.current) return
              const [x, y] = relative(event)
              const [sx, sy] = start.current
              start.current = undefined
              if (Math.abs(x - sx) < .01 || Math.abs(y - sy) < .01) return
              onRegion([Math.min(x, sx), Math.min(y, sy), Math.max(x, sx), Math.max(y, sy)], pageNumber)
            }}
          />
        )}
        </div>
      </div>
    </>
  )
}
