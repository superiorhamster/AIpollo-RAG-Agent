'use client'

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import { authenticatedFetch, readResponse } from '../../lib/api'

export type Region = [number, number, number, number]

export function PdfPreview({ url, page, onPage, regions = [], onRegion }: {
  url: string
  page: number
  onPage: (page: number) => void
  regions?: Region[]
  onRegion?: (region: Region, page: number) => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [loadError, setLoadError] = useState(false)
  const [renderError, setRenderError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const start = useRef<[number, number] | undefined>(undefined)
  const canvas = useRef<HTMLCanvasElement>(null)

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
    }
    void renderPage().catch(() => { if (active) setRenderError(true) })
    return () => {
      active = false
      task?.cancel()
    }
  }, [pdf, pageNumber])

  function relative(event: PointerEvent<HTMLDivElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    return [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)]
  }

  if (loadError || renderError) {
    return <div role="alert" className="form-stack">
      <p>Could not display this PDF.</p>
      <button type="button" className="secondary" onClick={() => {
        setPdf(undefined)
        setLoadError(false)
        setRenderError(false)
        setAttempt(value => value + 1)
      }}>Try preview again</button>
    </div>
  }

  return (
    <>
      {pdf ? (
        <div className="pdf-controls">
          <button type="button" className="secondary" disabled={pageNumber === 1}
            onClick={() => onPage(pageNumber - 1)}>Previous page</button>
          <span aria-live="polite">Page {pageNumber} of {pdf.numPages}</span>
          <button type="button" className="secondary" disabled={pageNumber === pdf.numPages}
            onClick={() => onPage(pageNumber + 1)}>Next page</button>
        </div>
      ) : <p role="status">Loading preview…</p>}
      <div className="pdf-stage" hidden={!pdf}>
        <canvas ref={canvas} role="img" aria-label={'PDF page ' + pageNumber} />
        {regions.map(([left, top, right, bottom], index) => <span key={index} className="pdf-highlight" style={{
          left: left * 100 + '%', top: top * 100 + '%',
          width: (right - left) * 100 + '%', height: (bottom - top) * 100 + '%',
        }} />)}
        {onRegion && <div className="pdf-selection"
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
          }} />}
      </div>
    </>
  )
}
