import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

export type ResizableSide = 'sidebar' | 'reader'
export type PanelWidths = Record<ResizableSide, number | null>

const STORAGE_KEY = 'aipollo-workspace-panel-widths'
const CENTER_MIN = 320

export const PANEL_BOUNDS: Record<ResizableSide, { min: number; max: number; cssVar: string }> = {
  sidebar: { min: 180, max: 480, cssVar: '--sidebar-width' },
  reader: { min: 280, max: 900, cssVar: '--reader-width' },
}

function clampStored(value: unknown, side: ResizableSide): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const { min, max } = PANEL_BOUNDS[side]
  return Math.round(Math.max(min, Math.min(max, value)))
}

function readStoredWidths(): PanelWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sidebar: null, reader: null }
    const parsed = JSON.parse(raw) as Partial<Record<ResizableSide, unknown>>
    return {
      sidebar: clampStored(parsed?.sidebar, 'sidebar'),
      reader: clampStored(parsed?.reader, 'reader'),
    }
  } catch {
    return { sidebar: null, reader: null }
  }
}

function writeStoredWidths(widths: PanelWidths): void {
  try {
    if (widths.sidebar === null && widths.reader === null) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Ignore storage quota or private-browsing failures
  }
}

function clampForContainer(side: ResizableSide, desired: number, containerWidth: number, otherWidth: number): number {
  const { min, max } = PANEL_BOUNDS[side]
  const maxByContainer = containerWidth > 0 ? containerWidth - otherWidth - CENTER_MIN : max
  const effectiveMax = Math.max(min, Math.min(max, maxByContainer))
  return Math.round(Math.max(min, Math.min(effectiveMax, desired)))
}

export function usePanelResize({
  bodyRef,
  sidebarRef,
  readerRef,
  readerVisible,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  sidebarRef: RefObject<HTMLElement | null>
  readerRef: RefObject<HTMLElement | null>
  readerVisible: boolean
}) {
  const [widths, setWidths] = useState<PanelWidths>({ sidebar: null, reader: null })
  const [activeSide, setActiveSide] = useState<ResizableSide | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)
  const cleanupDragRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setWidths(readStoredWidths())
  }, [])

  useEffect(() => {
    const bodyEl = bodyRef.current
    if (!bodyEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width ?? bodyEl.getBoundingClientRect().width
      setContainerWidth(Math.round(nextWidth))
    })
    observer.observe(bodyEl)
    return () => observer.disconnect()
  }, [bodyRef])

  useEffect(() => () => {
    cleanupDragRef.current?.()
  }, [])

  const effectiveWidths: PanelWidths = {
    sidebar: widths.sidebar === null ? null : clampForContainer(
      'sidebar',
      widths.sidebar,
      containerWidth,
      readerVisible ? (widths.reader ?? Math.max(300, Math.round(containerWidth * 0.2917))) : 0,
    ),
    reader: widths.reader === null ? null : clampForContainer(
      'reader',
      widths.reader,
      containerWidth,
      widths.sidebar ?? 264,
    ),
  }

  const commitWidth = useCallback((side: ResizableSide, value: number | null) => {
    setWidths(current => {
      const next = { ...current, [side]: value }
      writeStoredWidths(next)
      return next
    })
  }, [])

  const resetWidth = useCallback((side: ResizableSide) => {
    bodyRef.current?.style.removeProperty(PANEL_BOUNDS[side].cssVar)
    commitWidth(side, null)
  }, [bodyRef, commitWidth])

  const startResize = useCallback((side: ResizableSide, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const bodyEl = bodyRef.current
    const targetEl = side === 'sidebar' ? sidebarRef.current : readerRef.current
    if (!bodyEl || !targetEl) return

    cleanupDragRef.current?.()
    event.preventDefault()

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer/mouse events may lack an active pointerId
    }

    const startX = event.clientX
    const startWidth = targetEl.getBoundingClientRect().width
    const totalWidth = bodyEl.getBoundingClientRect().width
    const otherEl = side === 'sidebar' ? (readerVisible ? readerRef.current : null) : sidebarRef.current
    const otherWidth = otherEl ? otherEl.getBoundingClientRect().width : 0
    let latestWidth = clampForContainer(side, startWidth, totalWidth, otherWidth)

    setActiveSide(side)

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = side === 'sidebar' ? moveEvent.clientX - startX : startX - moveEvent.clientX
      latestWidth = clampForContainer(side, startWidth + delta, totalWidth, otherWidth)
      bodyEl.style.setProperty(PANEL_BOUNDS[side].cssVar, `${latestWidth}px`)
    }

    const finish = () => {
      cleanupDragRef.current?.()
      setActiveSide(null)
      commitWidth(side, latestWidth)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)

    cleanupDragRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      cleanupDragRef.current = null
    }
  }, [bodyRef, commitWidth, readerRef, readerVisible, sidebarRef])

  const handleKeyDown = useCallback((side: ResizableSide, event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === '0' || event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      resetWidth(side)
      return
    }
    const bodyEl = bodyRef.current
    const targetEl = side === 'sidebar' ? sidebarRef.current : readerRef.current
    if (!bodyEl || !targetEl) return

    const totalWidth = bodyEl.getBoundingClientRect().width
    const otherEl = side === 'sidebar' ? (readerVisible ? readerRef.current : null) : sidebarRef.current
    const otherWidth = otherEl ? otherEl.getBoundingClientRect().width : 0
    const currentWidth = targetEl.getBoundingClientRect().width

    let desired: number | null = null
    if (event.key === 'ArrowLeft') {
      desired = side === 'sidebar' ? currentWidth - step : currentWidth + step
    } else if (event.key === 'ArrowRight') {
      desired = side === 'sidebar' ? currentWidth + step : currentWidth - step
    } else if (event.key === 'Home') {
      desired = PANEL_BOUNDS[side].min
    } else if (event.key === 'End') {
      desired = PANEL_BOUNDS[side].max
    }
    if (desired === null) return

    event.preventDefault()
    commitWidth(side, clampForContainer(side, desired, totalWidth, otherWidth))
  }, [bodyRef, commitWidth, readerRef, readerVisible, resetWidth, sidebarRef])

  const bodyStyle: CSSProperties = {
    ...(effectiveWidths.sidebar !== null ? { '--sidebar-width': `${effectiveWidths.sidebar}px` } : {}),
    ...(effectiveWidths.reader !== null ? { '--reader-width': `${effectiveWidths.reader}px` } : {}),
  } as CSSProperties

  return {
    activeSide,
    bodyStyle,
    effectiveWidths,
    handleKeyDown,
    resetWidth,
    startResize,
  }
}
