'use client'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  Highlighter,
  MoreHorizontal,
  Plus,
  ScanText,
  SquareDashed,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { localEngine, type Annotation, type AnnotationRef } from '@embedpdf/engine'
import { Viewer, DocumentGate, usePageList, usePage } from '@embedpdf/react/runtime'
import { PageView } from '@embedpdf/react/page-view'
import { RenderLayer, renderPlugin, usePictureState } from '@embedpdf/react/render'
import { interactionPlugin } from '@embedpdf/react/interaction'
import { SelectionLayer, selectionPlugin, useSelection, useSelectionState } from '@embedpdf/react/selection'
import {
  AnnotationLayer,
  annotationPlugin,
  useAnnotation,
  useAnnotationState
} from '@embedpdf/react/annotation'
import { SearchLayer, searchPlugin, useSearch } from '@embedpdf/react/search'
import { pageEditPlugin, usePageEdit } from '@embedpdf/react/page-edit'
import { api, authenticatedFetch, errorMessage } from '../../lib/api'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import {
  cropSnapshot,
  legacyBox,
  legacyRegions,
  type AnnotationInput,
  type PersonalAnnotation,
  type Snapshot,
  type Box
} from './pdf-annotations'
import type { PdfPreviewProps, Region } from './pdf-preview'
import { computePopoverPosition, type PopoverPosition } from './popover-position'

const plugins = [
  renderPlugin({ fullPage: { maxWidth: 2048 } }),
  interactionPlugin(),
  selectionPlugin(),
  annotationPlugin({ editable: false }),
  searchPlugin(),
  pageEditPlugin()
]
const createEngine = () => localEngine()

// SDK downloads may supply absolute URLs. Keep renewal on the application's
// protected relative paths and never send session cookies to another origin.
function fetchDocument(url: string, init?: RequestInit): Promise<Response> {
  const target = new URL(url, window.location.href)
  if (target.origin !== window.location.origin) return Promise.reject(new Error('Invalid document origin'))
  return authenticatedFetch(target.pathname + target.search, { ...init, credentials: 'same-origin' })
}


export default function EmbedPdfReader(props: PdfPreviewProps) {
  const [attempt, setAttempt] = useState(0)
  const documents = useMemo(() => [{ source: { kind: 'url' as const, url: props.url } }], [props.url])
  const failure = () => (
    <div role="alert">
      <p>Could not display this PDF.</p>
      <button type="button" onClick={() => setAttempt((n) => n + 1)}>
        Try preview again
      </button>
    </div>
  )
  return (
    <Viewer
      key={attempt}
      engine={createEngine}
      plugins={plugins}
      initialDocuments={documents}
      fetch={fetchDocument}
      renderError={failure}
      fallback={<p role="status">Loading preview…</p>}
    >
      <DocumentGate fallback={<p role="status">Loading preview…</p>} error={failure}>
        <Reader {...props} />
      </DocumentGate>
    </Viewer>
  )
}

function Reader({
  annotationsUrl,
  page,
  onPage,
  citationRegion,
  citationRegions,
  onClearCitation,
  onPendingChange,
  onDirtyChange,
}: PdfPreviewProps) {
  const { text } = useWorkspaceLanguage()
  const panelBodyId = useId()
  const pages = usePageList()
  const index = Math.max(0, Math.min(page - 1, pages.length - 1))
  const current = pages[index]
  const annotation = useAnnotation()
  const status = useAnnotationState((s) => s.status)
  const selection = useSelection()
  const selectionState = useSelectionState()
  const [selectedText, setSelectedText] = useState('')
  const search = useSearch()
  const pageEdit = usePageEdit()
  const paper = useRef<HTMLDivElement>(null)
  const intrinsic = useRef(new Map<number, number>())
  for (const p of pages) if (!intrinsic.current.has(p.index)) intrinsic.current.set(p.index, p.rotation)
  const initialRotation = intrinsic.current.get(index) ?? 0
  const [size, setSize] = useState({ width: 300, height: 400 })
  const [fit, setFit] = useState<'width' | 'page' | 'custom'>('width')
  const [zoom, setZoom] = useState(1)
  const [pageInput, setPageInput] = useState(String(page))
  const [findOpen, setFindOpen] = useState(false)
  const [findResult, setFindResult] = useState('')
  const [finding, setFinding] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<PersonalAnnotation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [body, setBody] = useState('')
  const [area, setArea] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<() => Promise<void>>()
  const [saved, setSaved] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draftPage, setDraftPage] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<PopoverPosition | null>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const rowMenuTriggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const rowMenuPopoverRef = useRef<HTMLDivElement>(null)
  const rowMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const refs = useRef(new Map<string, AnnotationRef>())
  const hydrated = useRef(new Set<string>())
  const alive = useRef(true)
  const inFlight = useRef(false)
  const boxes = useMemo(
    () => (citationRegions?.length ? citationRegions : citationRegion ? [citationRegion] : []),
    [citationRegions, citationRegion]
  )
  useEffect(() => {
    let active = true
    setSelectedText('')
    if (selection.hasSelection() && !selection.isSelecting()) {
      void selection
        .readText()
        .then((value) => {
          if (active) setSelectedText(value)
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [selection, selectionState, index])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    setPageInput(String(index + 1))
    setArea(false)
  }, [index])
  useEffect(() => {
    const el = paper.current
    if (!el) return
    const observer = new ResizeObserver(() =>
      setSize({
        width: Math.max(1, el.clientWidth - 16),
        height: Math.max(1, el.clientHeight - 16)
      })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    void api<PersonalAnnotation[]>(annotationsUrl)
      .then((rows) => {
        if (active) {
          setItems(rows)
          setLoaded(true)
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
  }, [annotationsUrl])
  const editingItem = editing ? items.find((r) => r.annotation_id === editing) : undefined
  const isDirty = composerOpen && (editingItem ? body !== editingItem.body : body.trim().length > 0)
  useEffect(() => {
    onPendingChange?.(busy || !!retry)
    return () => onPendingChange?.(false)
  }, [busy, retry, onPendingChange])
  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])
  useEffect(() => {
    if (!saved || busy || retry) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved, busy, retry])
  useEffect(() => {
    if (!panelOpen || !composerOpen) return
    const frame = requestAnimationFrame(() => noteInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [panelOpen, composerOpen, editing, draftPage])
  const updateRowMenuPosition = useCallback(() => {
    if (!openMenuId) return
    const trigger = rowMenuTriggerRefs.current.get(openMenuId)
    if (!trigger) return
    setMenuPosition(computePopoverPosition(trigger, 152, true, 110))
  }, [openMenuId])
  useLayoutEffect(() => {
    if (!openMenuId) {
      setMenuPosition(null)
      return
    }
    updateRowMenuPosition()
    const frame = requestAnimationFrame(() => rowMenuItemRefs.current[0]?.focus())
    window.addEventListener('resize', updateRowMenuPosition)
    window.addEventListener('scroll', updateRowMenuPosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateRowMenuPosition)
      window.removeEventListener('scroll', updateRowMenuPosition, true)
    }
  }, [openMenuId, updateRowMenuPosition])
  useEffect(() => {
    if (!openMenuId) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      const trigger = rowMenuTriggerRefs.current.get(openMenuId)
      if (!rowMenuPopoverRef.current?.contains(target) && !trigger?.contains(target)) {
        setOpenMenuId(null)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const id = openMenuId
      setOpenMenuId(null)
      const trigger = rowMenuTriggerRefs.current.get(id)
      trigger?.focus()
      requestAnimationFrame(() => rowMenuTriggerRefs.current.get(id)?.focus())
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenuId])
  useEffect(() => {
    if (!retry && !busy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [retry, busy])
  useEffect(() => {
    if (status !== 'ready' || !loaded) return
    let active = true
    async function hydrate() {
      for (const item of items) {
        if (hydrated.current.has(item.annotation_id) || !item.embedpdf) continue
        hydrated.current.add(item.annotation_id)
        try {
          const { version, quadPoints, ...fields } = item.embedpdf
          void version
          const draft =
            fields.subtype === 'highlight'
              ? { ...fields, subtype: 'highlight' as const, quadPoints }
              : fields.subtype === 'square'
                ? { ...fields, subtype: 'square' as const }
                : { ...fields, subtype: 'text' as const }
          const result = await annotation.create(item.page - 1, {
            ...draft,
            contents: item.body
          })
          refs.current.set(item.annotation_id, result.annotation.ref)
        } catch (e) {
          hydrated.current.delete(item.annotation_id)
          if (active) setError(errorMessage(e))
        }
      }
    }
    void hydrate()
    return () => {
      active = false
    }
  }, [status, loaded, items, annotation])

  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await operation()
      if (alive.current) {
        setRetry(undefined)
        setSaved(true)
      }
    } catch (e) {
      if (alive.current) {
        setError(errorMessage(e))
        setRetry(() => operation)
      }
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  function remember(value: PersonalAnnotation) {
    setItems((rows) => {
      const exists = rows.some((r) => r.annotation_id === value.annotation_id)
      return exists ? rows.map((r) => (r.annotation_id === value.annotation_id ? value : r)) : [...rows, value]
    })
  }
  function snapshot(value: Annotation): Snapshot {
    if (value.subtype !== 'highlight' && value.subtype !== 'text' && value.subtype !== 'square')
      throw new Error('Unsupported annotation')
    return {
      version: 1,
      subtype: value.subtype,
      rect: value.rect,
      quadPoints: value.subtype === 'highlight' ? [...value.quadPoints] : [],
      color: value.color ?? '#ffcf40',
      opacity: value.opacity
    }
  }
  async function store(value: Annotation) {
    const identifier = crypto.randomUUID()
    const state = cropSnapshot(snapshot(value), current.size.width, current.size.height)
    const regions = legacyRegions(state, current.size.width, current.size.height, initialRotation)
    const input: AnnotationInput = {
      page: index + 1,
      body: value.contents ?? '',
      region: null,
      regions,
      embedpdf: state
    }
    refs.current.set(identifier, value.ref)
    hydrated.current.add(identifier)
    await run(async () => remember(await api<PersonalAnnotation>(annotationsUrl, 'POST', input, identifier)))
  }
  async function highlight() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const result = await annotation.createFromSelection('highlight')
      inFlight.current = false
      if (result.annotations[0]) await store(result.annotations[0])
      else setBusy(false)
    } catch (e) {
      inFlight.current = false
      setBusy(false)
      setError(errorMessage(e))
    }
  }
  async function rectangle(rect: Box) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setArea(false)
    try {
      const result = await annotation.create(index, {
        subtype: 'highlight',
        rect,
        quadPoints: [
          {
            upperLeft: { x: rect.x, y: rect.y },
            upperRight: { x: rect.x + rect.width, y: rect.y },
            lowerLeft: { x: rect.x, y: rect.y + rect.height },
            lowerRight: { x: rect.x + rect.width, y: rect.y + rect.height }
          }
        ],
        color: '#ffcf40',
        opacity: 0.4
      })
      inFlight.current = false
      await store(result.annotation)
    } catch (e) {
      inFlight.current = false
      setBusy(false)
      setError(errorMessage(e))
    }
  }
  const composerPage = editingItem?.page ?? draftPage ?? (index + 1)

  function confirmDiscardDraft(): boolean {
    if (!isDirty) return true
    return window.confirm(text(
      'Discard unsaved note draft?',
      'Bạn có thay đổi ghi chú chưa lưu. Hủy bản nháp?',
    ))
  }

  function openNewNote() {
    if (!confirmDiscardDraft()) return
    setOpenMenuId(null)
    setConfirmDeleteId(null)
    setPanelOpen(true)
    setEditing(undefined)
    setBody('')
    setDraftPage(index + 1)
    setComposerOpen(true)
  }

  function openEditAnnotation(item: PersonalAnnotation) {
    if (item.annotation_id !== editing && !confirmDiscardDraft()) return
    setOpenMenuId(null)
    setConfirmDeleteId(null)
    setPanelOpen(true)
    setEditing(item.annotation_id)
    setBody(item.body)
    setDraftPage(item.page)
    setComposerOpen(true)
  }

  function cancelComposer() {
    setComposerOpen(false)
    setEditing(undefined)
    setBody('')
    setDraftPage(null)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || busy || retry) return
    const item = items.find((r) => r.annotation_id === editing)
    const identifier = item?.annotation_id ?? crypto.randomUUID()
    const input: AnnotationInput = item
      ? {
          page: item.page,
          body: body.trim(),
          region: item.region,
          regions: item.regions,
          embedpdf: item.embedpdf
        }
      : { page: composerPage, body: body.trim(), region: null }
    void run(async () => {
      const result = await api<PersonalAnnotation>(
        item ? annotationsUrl + '/' + identifier : annotationsUrl,
        item ? 'PATCH' : 'POST',
        input,
        item ? undefined : identifier
      )
      remember(result)
      const ref = refs.current.get(identifier)
      if (ref) await annotation.update(ref, { contents: result.body })
      if (alive.current) {
        setBody('')
        setEditing(undefined)
        setDraftPage(null)
        setComposerOpen(false)
      }
    })
  }
  async function remove(item: PersonalAnnotation) {
    await run(async () => {
      await api(annotationsUrl + '/' + item.annotation_id, 'DELETE')
      const ref = refs.current.get(item.annotation_id)
      if (ref) await annotation.delete(ref)
      refs.current.delete(item.annotation_id)
      if (editing === item.annotation_id) {
        setEditing(undefined)
        setBody('')
        setDraftPage(null)
        setComposerOpen(false)
      }
      setConfirmDeleteId(null)
      setItems((rows) => rows.filter((r) => r.annotation_id !== item.annotation_id))
    })
  }
  async function find(event?: FormEvent, previous = false) {
    event?.preventDefault()
    setFinding(true)
    try {
      const form = event?.currentTarget as HTMLFormElement | undefined
      const query = form ? String(new FormData(form).get('find')).trim() : (search.getQuery()?.text ?? '')
      if (!query) return
      if (search.getQuery()?.text !== query) await search.search({ text: query }, { from: index })
      else if (previous) search.previousHit()
      else search.nextHit()
      const hit = search.getActiveHit()
      if (hit) {
        onPage(hit.pageIndex + 1)
        setFindResult('Match on page ' + (hit.pageIndex + 1))
      } else setFindResult('No matching text found in this PDF.')
    } catch {
      setFindResult('Could not search text in this PDF.')
    } finally {
      setFinding(false)
    }
  }
  if (!current) return <p role="status">Loading page…</p>
  const rotated = current.rotation % 180 !== 0
  const displayWidth = rotated ? current.size.height : current.size.width
  const displayHeight = rotated ? current.size.width : current.size.height
  const widthScale = size.width / displayWidth
  const fitScale = fit === 'page' ? Math.min(widthScale, size.height / displayHeight) : widthScale
  const scale = fit === 'custom' ? zoom : fitScale
  const width = Math.max(1, current.size.width * scale)
  const changeZoom = (factor: number) => {
    setZoom(Math.max(0.05, Math.min(8, scale * factor)))
    setFit('custom')
  }
  const personal = items.filter((i) => i.page === index + 1)
  const legacy = personal
    .filter((i) => !i.embedpdf)
    .flatMap((i) => (i.regions?.length ? i.regions : i.region ? [i.region] : []))
  const disabled = busy || !!retry || !loaded || status !== 'ready'
  return (
    <>
      <div className="pdf-controls">
        <button type="button" aria-label="Previous page" disabled={index === 0} onClick={() => onPage(index)}>
          ‹
        </button>
        <form
          className="pdf-page-jump"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(pageInput)
            if (Number.isInteger(n) && n >= 1 && n <= pages.length) onPage(n)
            else setError('Enter a valid page number.')
          }}
        >
          <span>
            {text('Page', 'Trang')} {index + 1} {text('of', 'trên')} {pages.length}
          </span>
          <input
            type="number"
            aria-label={text('Page number', 'Số trang')}
            min={1}
            max={pages.length}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
          />
          <button type="submit">{text('Go', 'Đi')}</button>
        </form>
        <button
          type="button"
          aria-label="Next page"
          disabled={index === pages.length - 1}
          onClick={() => onPage(index + 2)}
        >
          ›
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => changeZoom(0.8)}>
          −
        </button>
        <button type="button" aria-label="Reset zoom" onClick={() => setFit('width')}>
          {Math.round(scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => changeZoom(1.25)}>
          +
        </button>
        <button type="button" aria-pressed={fit === 'width'} onClick={() => setFit('width')}>
          Fit width
        </button>
        <button type="button" aria-pressed={fit === 'page'} onClick={() => setFit('page')}>
          Fit page
        </button>
        <button
          type="button"
          aria-label="Rotate clockwise"
          onClick={() => void pageEdit.rotateBy([index], 90).catch((e) => setError(errorMessage(e)))}
        >
          ↻
        </button>
        <button
          type="button"
          aria-label="Find in PDF"
          aria-expanded={findOpen}
          onClick={() => setFindOpen((v) => !v)}
        >
          Find
        </button>
      </div>
      {!!boxes.length && onClearCitation && (
        <button type="button" className="secondary sm" onClick={onClearCitation}>
          {text('Clear highlight', 'Bỏ tô sáng trích dẫn')}
        </button>
      )}
      {findOpen && (
        <form className="reader-find" onSubmit={find}>
          <input type="search" name="find" aria-label="Text to find" required />
          <button disabled={finding}>Find next</button>
          <button type="button" disabled={finding} onClick={() => void find(undefined, true)}>
            Find previous
          </button>
          {findResult && <p role="status">{findResult}</p>}
        </form>
      )}
      <div
        ref={paper}
        className="pdf-paper embed-paper"
        tabIndex={0}
        role="region"
        aria-label={text('Scrollable PDF page', 'Trang PDF có thể cuộn')}
      >
        <PageView page={index} width={width} className="embed-page">
          <RenderLayer />
          <SelectionLayer />
          <AnnotationLayer />
          <SearchLayer />
          <PageMarks
            boxes={boxes}
            legacy={legacy}
            intrinsic={initialRotation}
            width={current.size.width}
            height={current.size.height}
            page={index + 1}
            area={area}
            onRectangle={rectangle}
          />
        </PageView>
      </div>
      <section className="reader-annotations" aria-label={text('Personal annotations', 'Ghi chú cá nhân')}>
        <div className="annotations-toolbar" role="toolbar" aria-label={text('PDF annotation tools', 'Công cụ ghi chú PDF')}>
          <button
            type="button"
            className="secondary sm ann-tool-btn"
            disabled={disabled}
            aria-label={text('Select page text', 'Chọn chữ trang')}
            title={text('Select page text', 'Chọn chữ trang')}
            onClick={() => selection.selectPage(index)}
          >
            <ScanText size={14} aria-hidden="true" />
            <span className="ann-tool-label">{text('Select page text', 'Chọn chữ trang')}</span>
          </button>
          <button
            type="button"
            className="secondary sm ann-tool-btn"
            disabled={!selectedText.trim()}
            aria-label={text('Copy text', 'Sao chép')}
            title={text('Copy text', 'Sao chép')}
            onClick={() =>
              void navigator.clipboard.writeText(selectedText).catch((e) => setError(errorMessage(e)))
            }
          >
            <Copy size={14} aria-hidden="true" />
            <span className="ann-tool-label">{text('Copy text', 'Sao chép')}</span>
          </button>
          <button
            type="button"
            className="secondary sm ann-tool-btn"
            disabled={disabled || !selectedText.trim()}
            aria-label={text('Highlight text', 'Tô sáng chữ')}
            title={text('Highlight text', 'Tô sáng chữ')}
            onClick={() => void highlight()}
          >
            <Highlighter size={14} aria-hidden="true" />
            <span className="ann-tool-label">{text('Highlight text', 'Tô sáng chữ')}</span>
          </button>
          <button
            type="button"
            className="secondary sm ann-tool-btn"
            disabled={disabled}
            aria-pressed={area}
            aria-label={area ? text('Cancel selection', 'Hủy đánh dấu vùng') : text('Select highlight', 'Đánh dấu vùng')}
            title={area ? text('Cancel selection', 'Hủy đánh dấu vùng') : text('Select highlight', 'Đánh dấu vùng')}
            onClick={() => setArea((v) => !v)}
          >
            <SquareDashed size={14} aria-hidden="true" />
            <span className="ann-tool-label">{area ? text('Cancel selection', 'Hủy chọn vùng') : text('Select highlight', 'Đánh dấu vùng')}</span>
          </button>
        </div>

        {area && (
          <div className="annotations-area-hint" role="status">
            <span>{text('Drag across a region on the PDF page.', 'Kéo chọn một vùng trên trang PDF.')}</span>
            <button type="button" className="secondary sm" onClick={() => setArea(false)}>
              {text('Cancel', 'Hủy')}
            </button>
          </div>
        )}

        <header className="annotations-header">
          <div className="annotations-title-group">
            <h3>{text('Notes & highlights', 'Ghi chú & đánh dấu')}</h3>
            <span className="annotations-meta">
              {text(`p. ${index + 1}`, `tr. ${index + 1}`)} · {personal.length === 1 ? text('1 item', '1 mục') : text(`${personal.length} items`, `${personal.length} mục`)}
            </span>
            {saved && !busy && !retry && (
              <span role="status" className="ann-saved-pill">{text('Annotation saved.', 'Đã lưu')}</span>
            )}
          </div>
          <div className="annotations-header-actions">
            <button
              type="button"
              className="secondary sm"
              disabled={disabled}
              onClick={openNewNote}
            >
              <Plus size={13} aria-hidden="true" />
              <span>{text('Add note', 'Thêm ghi chú')}</span>
            </button>
            <button
              id="annotations-toggle"
              type="button"
              className="ghost sm annotations-toggle-btn"
              aria-expanded={panelOpen}
              aria-controls={panelBodyId}
              aria-label={panelOpen ? text('Collapse notes', 'Thu gọn ghi chú') : text('Expand notes', 'Mở rộng ghi chú')}
              title={panelOpen ? text('Collapse notes', 'Thu gọn ghi chú') : text('Expand notes', 'Mở rộng ghi chú')}
              onClick={() => setPanelOpen((open) => !open)}
            >
              {panelOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            </button>
          </div>
        </header>

        {busy && <p role="status" className="ann-status">{text('Saving annotation…', 'Đang lưu ghi chú…')}</p>}
        {error && <p role="alert" className="ann-error">{error}</p>}
        {retry && (
          <div className="actions">
            <button type="button" className="sm" disabled={busy} onClick={() => void run(retry)}>
              {text('Retry saving annotation', 'Thử lưu lại')}
            </button>
            <button type="button" className="secondary sm" disabled={busy} onClick={() => window.location.reload()}>
              {text('Discard unsaved changes', 'Bỏ thay đổi chưa lưu')}
            </button>
          </div>
        )}
        {!loaded && error && (
          <button
            type="button"
            className="secondary sm"
            onClick={() =>
              void api<PersonalAnnotation[]>(annotationsUrl)
                .then((rows) => {
                  setItems(rows)
                  setLoaded(true)
                  setError('')
                })
                .catch((e) => setError(errorMessage(e)))
            }
          >
            {text('Retry loading annotations', 'Thử tải lại ghi chú')}
          </button>
        )}

        {panelOpen && (
          <div id={panelBodyId} className="annotations-body">
            {composerOpen && (
              <form className="annotations-composer" onSubmit={submit}>
                <div className="annotations-composer-head">
                  <h4>
                    {editing ? text('Edit note', 'Sửa ghi chú') : text('New note', 'Ghi chú mới')} · {text(`p. ${composerPage}`, `tr. ${composerPage}`)}
                  </h4>
                  <span className="muted ann-char-count">{body.length}/3000</span>
                </div>
                <textarea
                  ref={noteInputRef}
                  id="annotation-body"
                  aria-label={text('Personal note', 'Ghi chú cá nhân')}
                  disabled={busy || !!retry}
                  name="body"
                  maxLength={3000}
                  rows={2}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={text('Write a note linked to this page…', 'Viết ghi chú gắn với trang này…')}
                />
                <div className="actions">
                  <button type="submit" className="sm" disabled={disabled || !body.trim()}>
                    {editing ? text('Save changes', 'Lưu thay đổi') : text('Save note', 'Lưu ghi chú')}
                  </button>
                  <button type="button" className="secondary sm" onClick={cancelComposer}>
                    {text('Cancel', 'Hủy')}
                  </button>
                </div>
              </form>
            )}

            {personal.length > 0 ? (
              <ul className="annotations-list">
                {personal.map((item) => {
                  const isHighlight = Boolean(item.embedpdf || item.region || item.regions?.length)
                  const confirmingDelete = confirmDeleteId === item.annotation_id
                  return (
                    <li key={item.annotation_id} className="annotation-row">
                      <span className="annotation-row-icon" aria-hidden="true">
                        {isHighlight ? <Highlighter size={14} /> : <StickyNote size={14} />}
                      </span>
                      <div className="annotation-row-content">
                        <p className={item.body ? undefined : 'muted'}>
                          {item.body || text('Highlight', 'Đánh dấu')}
                        </p>
                        {confirmingDelete && (
                          <div className="annotation-delete-confirm">
                            <span>{text('Delete this item?', 'Xóa mục này?')}</span>
                            <button
                              type="button"
                              className="danger sm"
                              disabled={disabled}
                              onClick={() => void remove(item)}
                            >
                              {text('Confirm delete', 'Xác nhận xóa')}
                            </button>
                            <button
                              type="button"
                              className="secondary sm"
                              disabled={disabled}
                              onClick={() => {
                                setConfirmDeleteId(null)
                                requestAnimationFrame(() => rowMenuTriggerRefs.current.get(item.annotation_id)?.focus())
                              }}
                            >
                              {text('Cancel', 'Hủy')}
                            </button>
                          </div>
                        )}
                      </div>
                      {!confirmingDelete && (
                        <button
                          ref={(el) => {
                            if (el) rowMenuTriggerRefs.current.set(item.annotation_id, el)
                            else rowMenuTriggerRefs.current.delete(item.annotation_id)
                          }}
                          type="button"
                          className="ghost sm annotation-row-menu-btn"
                          disabled={disabled}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === item.annotation_id}
                          aria-label={text('Annotation actions', 'Thao tác ghi chú')}
                          title={text('Annotation actions', 'Thao tác ghi chú')}
                          onClick={() => setOpenMenuId((cur) => (cur === item.annotation_id ? null : item.annotation_id))}
                        >
                          <MoreHorizontal size={14} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted ann-empty">
                {text(
                  'No notes or highlights on this page yet. Select text, mark a region, or click Add note.',
                  'Chưa có ghi chú hay đánh dấu nào ở trang này. Hãy chọn chữ, đánh dấu vùng hoặc bấm Thêm ghi chú.',
                )}
              </p>
            )}
          </div>
        )}

        {openMenuId && menuPosition && typeof document !== 'undefined' && (() => {
          const targetItem = personal.find((row) => row.annotation_id === openMenuId)
          if (!targetItem) return null
          return createPortal(
            <div
              ref={rowMenuPopoverRef}
              id={`annotation-menu-${targetItem.annotation_id}`}
              role="menu"
              aria-label={text('Annotation actions', 'Thao tác ghi chú')}
              className="reader-popover reader-actions-popover"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
                minWidth: menuPosition.width,
              }}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                const menuButtons = rowMenuItemRefs.current.filter((b): b is HTMLButtonElement => Boolean(b && !b.disabled))
                if (!menuButtons.length) return
                const currentIdx = menuButtons.findIndex((b) => b === document.activeElement)
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  menuButtons[(currentIdx + 1) % menuButtons.length]?.focus()
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  menuButtons[(currentIdx - 1 + menuButtons.length) % menuButtons.length]?.focus()
                }
              }}
            >
              <button
                ref={(el) => { rowMenuItemRefs.current[0] = el }}
                type="button"
                role="menuitem"
                className="reader-menu-item"
                disabled={disabled}
                onClick={() => openEditAnnotation(targetItem)}
              >
                <Edit3 size={14} aria-hidden="true" />
                <span>{text('Edit annotation', 'Sửa')}</span>
              </button>
              <button
                ref={(el) => { rowMenuItemRefs.current[1] = el }}
                type="button"
                role="menuitem"
                className="reader-menu-item reader-menu-danger"
                disabled={disabled}
                onClick={() => {
                  setOpenMenuId(null)
                  setConfirmDeleteId(targetItem.annotation_id)
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{text('Remove annotation', 'Xóa')}</span>
              </button>
            </div>,
            document.body,
          )
        })()}
      </section>
    </>
  )
}

function PageMarks({
  boxes,
  legacy,
  intrinsic,
  width,
  height,
  page,
  area,
  onRectangle
}: {
  boxes: Region[]
  legacy: Region[]
  intrinsic: number
  width: number
  height: number
  page: number
  area: boolean
  onRectangle: (box: Box) => Promise<void>
}) {
  const context = usePage()
  const picture = usePictureState()
  const marker = useRef<HTMLSpanElement>(null)
  const begin = useRef<{ x: number; y: number } | undefined>(undefined)
  useEffect(() => {
    if (picture.status === 'ready') marker.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [boxes, picture.status])
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.closest('.embed-page')!.getBoundingClientRect()
    const p = context.transform.viewToPage({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    return {
      x: Math.max(0, Math.min(width, p.x)),
      y: Math.max(0, Math.min(height, p.y))
    }
  }
  return (
    <>
      <span
        role="img"
        aria-label={'PDF page ' + page}
        data-rendered={picture.status === 'ready'}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      {picture.status === 'error' && <p role="alert">Could not render this page.</p>}
      {[...boxes, ...legacy].map((r, i) => {
        const b = legacyBox(r, width, height, intrinsic)
        const p = context.transform.toPixels(b)
        return (
          <span
            key={i}
            ref={i === 0 && boxes.length > 0 ? marker : undefined}
            className={'pdf-highlight ' + (i < boxes.length ? 'citation-highlight' : '')}
            role={i < boxes.length ? 'mark' : undefined}
            aria-label={i < boxes.length ? 'Citation highlight' : undefined}
            style={{
              left: p.x,
              top: p.y,
              width: b.width * context.transform.viewScale,
              height: b.height * context.transform.viewScale
            }}
          />
        )
      })}
      {area && (
        <div
          className="pdf-selection"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            begin.current = point(e)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerCancel={() => {
            begin.current = undefined
          }}
          onPointerUp={(e) => {
            const a = begin.current
            begin.current = undefined
            if (!a) return
            const b = point(e)
            const rect = {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(a.x - b.x),
              height: Math.abs(a.y - b.y)
            }
            if (rect.width > 1 && rect.height > 1) void onRectangle(rect)
          }}
        />
      )}
    </>
  )
}
