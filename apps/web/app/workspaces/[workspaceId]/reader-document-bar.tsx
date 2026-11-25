'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Download, Edit3, FileText, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { DesignIcon } from '../../components/aipollo'
import { useWorkspaceLanguage } from '../../components/workspace-language'
import type { DocumentItem } from './document-shelf'
import { computePopoverPosition, type PopoverPosition } from './popover-position'

export type RenameOutcome = { ok: true } | { ok: false; error: string }

export type ReaderDocumentBarProps = {
  documents: DocumentItem[]
  selectedDoc?: DocumentItem
  busy: boolean
  mayWrite: boolean
  annotationPending: boolean
  onSelect: (documentId: string) => void
  onDownload: (documentId: string) => void
  onRename: (documentId: string, name: string) => Promise<RenameOutcome>
  onDelete: (document: DocumentItem) => void
  onHideReader: () => void
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase()
}

export function ReaderDocumentBar({
  documents,
  selectedDoc,
  busy,
  mayWrite,
  annotationPending,
  onSelect,
  onDownload,
  onRename,
  onDelete,
  onHideReader,
}: ReaderDocumentBarProps) {
  const { text } = useWorkspaceLanguage()
  const pickerListId = useId()
  const menuId = useId()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [draftName, setDraftName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<PopoverPosition | null>(null)
  const [menuPosition, setMenuPosition] = useState<PopoverPosition | null>(null)

  const pickerTriggerRef = useRef<HTMLButtonElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const pickerPopoverRef = useRef<HTMLDivElement>(null)
  const menuPopoverRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeDocIdRef = useRef<string | undefined>(selectedDoc?.document_id)
  activeDocIdRef.current = selectedDoc?.document_id

  const normalizedQuery = normalizeSearchText(searchQuery.trim())
  const filteredDocuments = useMemo(() => {
    if (!normalizedQuery) return documents
    return documents.filter(doc =>
      normalizeSearchText(doc.name).includes(normalizedQuery)
      || normalizeSearchText(doc.filename).includes(normalizedQuery),
    )
  }, [documents, normalizedQuery])

  // Close transient menus/forms whenever active document changes or annotation becomes pending
  useEffect(() => {
    setPickerOpen(false)
    setMenuOpen(false)
    setRenameOpen(false)
    setRenameError('')
    setSearchQuery('')
  }, [selectedDoc?.document_id])

  useEffect(() => {
    if (annotationPending) {
      setPickerOpen(false)
      setMenuOpen(false)
    }
  }, [annotationPending])

  // Sync highlighted option index when search results change or picker opens
  useEffect(() => {
    if (!pickerOpen) return
    const selectedIdx = selectedDoc
      ? filteredDocuments.findIndex(doc => doc.document_id === selectedDoc.document_id)
      : -1
    setHighlightIndex(selectedIdx >= 0 ? selectedIdx : 0)
  }, [pickerOpen, filteredDocuments, selectedDoc])

  const updatePickerPosition = useCallback(() => {
    const anchor = pickerTriggerRef.current
    if (!anchor) return
    const desired = Math.max(anchor.getBoundingClientRect().width, 260)
    setPickerPosition(computePopoverPosition(anchor, Math.min(desired, 380), false, 320))
  }, [])

  const updateMenuPosition = useCallback(() => {
    const anchor = menuTriggerRef.current
    if (!anchor) return
    setMenuPosition(computePopoverPosition(anchor, 184, true, 160))
  }, [])

  useLayoutEffect(() => {
    if (!pickerOpen) {
      setPickerPosition(null)
      return
    }
    updatePickerPosition()
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus())
    window.addEventListener('resize', updatePickerPosition)
    window.addEventListener('scroll', updatePickerPosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePickerPosition)
      window.removeEventListener('scroll', updatePickerPosition, true)
    }
  }, [pickerOpen, updatePickerPosition])

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null)
      return
    }
    updateMenuPosition()
    const frame = requestAnimationFrame(() => menuItemRefs.current[0]?.focus())
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [menuOpen, updateMenuPosition])

  useEffect(() => {
    if (!renameOpen) return
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [renameOpen])

  const closePicker = useCallback((returnFocus = false) => {
    setPickerOpen(false)
    setSearchQuery('')
    if (returnFocus) {
      pickerTriggerRef.current?.focus()
      requestAnimationFrame(() => pickerTriggerRef.current?.focus())
    }
  }, [])

  const closeMenu = useCallback((returnFocus = false) => {
    setMenuOpen(false)
    if (returnFocus) {
      menuTriggerRef.current?.focus()
      requestAnimationFrame(() => menuTriggerRef.current?.focus())
    }
  }, [])

  // Dismiss open popovers on outside click or Escape (handles presses before focus moves into portal)
  useEffect(() => {
    if (!pickerOpen && !menuOpen) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (pickerOpen && !pickerTriggerRef.current?.contains(target) && !pickerPopoverRef.current?.contains(target)) {
        setPickerOpen(false)
      }
      if (menuOpen && !menuTriggerRef.current?.contains(target) && !menuPopoverRef.current?.contains(target)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pickerOpen) {
        event.preventDefault()
        closePicker(true)
      } else if (menuOpen) {
        event.preventDefault()
        closeMenu(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen, menuOpen, closePicker, closeMenu])

  const openRenameForm = () => {
    if (!selectedDoc || annotationPending) return
    setMenuOpen(false)
    setPickerOpen(false)
    setDraftName(selectedDoc.name)
    setRenameError('')
    setRenameOpen(true)
  }

  const cancelRename = () => {
    setRenameOpen(false)
    setRenameError('')
    requestAnimationFrame(() => menuTriggerRef.current?.focus())
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDoc || renaming || annotationPending) return
    const targetId = selectedDoc.document_id
    const trimmed = draftName.trim()
    if (trimmed.length < 1 || trimmed.length > 200) {
      setRenameError(text(
        'Enter a document name between 1 and 200 characters.',
        'Tên tài liệu phải dài từ 1 đến 200 ký tự.',
      ))
      renameInputRef.current?.focus()
      return
    }
    setRenaming(true)
    setRenameError('')
    try {
      const outcome = await onRename(targetId, trimmed)
      if (activeDocIdRef.current !== targetId) return
      if (outcome.ok) {
        setRenameOpen(false)
        setRenameError('')
        requestAnimationFrame(() => pickerTriggerRef.current?.focus())
      } else {
        setRenameError(outcome.error)
        renameInputRef.current?.focus()
      }
    } finally {
      setRenaming(false)
    }
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!filteredDocuments.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = (highlightIndex + 1) % filteredDocuments.length
      setHighlightIndex(next)
      optionRefs.current[next]?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (highlightIndex - 1 + filteredDocuments.length) % filteredDocuments.length
      setHighlightIndex(next)
      optionRefs.current[next]?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && document.activeElement === searchInputRef.current) {
      event.preventDefault()
      const chosen = filteredDocuments[highlightIndex]
      if (chosen) {
        onSelect(chosen.document_id)
        closePicker(true)
      }
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled))
    if (!items.length) return
    const currentIdx = items.findIndex(item => item === document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIdx + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIdx - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  const triggerLabel = selectedDoc
    ? selectedDoc.name
    : documents.length > 0
      ? text('Select document', 'Chọn tài liệu')
      : text('No documents', 'Chưa có tài liệu')

  return (
    <div className="reader-header">
      <div className="reader-toolbar">
        <button
          ref={pickerTriggerRef}
          type="button"
          className="secondary sm reader-doc-trigger"
          title={triggerLabel}
          aria-label={triggerLabel}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerListId : undefined}
          disabled={annotationPending || !documents.length}
          onClick={() => {
            setMenuOpen(false)
            setPickerOpen(open => !open)
          }}
        >
          <FileText size={14} className="reader-doc-icon" aria-hidden="true" />
          <span className="reader-doc-name">{triggerLabel}</span>
          <ChevronDown size={14} className="reader-doc-caret" aria-hidden="true" />
        </button>

        <div className="reader-toolbar-actions">
          {selectedDoc && (
            <button
              type="button"
              className="ghost sm reader-tool-btn"
              disabled={busy}
              aria-label={text('Download original', 'Tải bản gốc')}
              title={text('Download original', 'Tải bản gốc')}
              onClick={() => onDownload(selectedDoc.document_id)}
            >
              <Download size={14} aria-hidden="true" />
            </button>
          )}
          {selectedDoc && mayWrite && (
            <button
              ref={menuTriggerRef}
              type="button"
              className="ghost sm reader-tool-btn"
              disabled={busy || annotationPending}
              aria-label={text('Document actions', 'Thao tác tài liệu')}
              title={text('Document actions', 'Thao tác tài liệu')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => {
                setPickerOpen(false)
                setMenuOpen(open => !open)
              }}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="ghost sm reader-hide"
            aria-label={text('Hide reader', 'Ẩn trình đọc')}
            title={text('Hide reader', 'Ẩn trình đọc')}
            disabled={annotationPending}
            onClick={onHideReader}
          >
            <DesignIcon name="panel" />
          </button>
        </div>
      </div>

      {annotationPending && (
        <p role="status" className="reader-pending-notice">
          <DesignIcon name="warning" />
          <span>
            {text(
              'Save or discard the pending annotation before switching, renaming, or deleting.',
              'Hãy lưu hoặc hủy ghi chú đang chờ trước khi đổi, sửa tên hoặc xóa tài liệu.',
            )}
          </span>
        </p>
      )}

      {renameOpen && selectedDoc && mayWrite && (
        <form className="reader-rename-form" method="post" onSubmit={handleRenameSubmit}>
          <div className="reader-rename-row">
            <input
              ref={renameInputRef}
              type="text"
              name="name"
              value={draftName}
              maxLength={200}
              disabled={renaming || annotationPending}
              aria-label={text('Document name', 'Tên tài liệu')}
              onChange={event => {
                setDraftName(event.currentTarget.value)
                if (renameError) setRenameError('')
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelRename()
                }
              }}
            />
            <button type="submit" className="sm" disabled={renaming || annotationPending}>
              {renaming ? text('Saving…', 'Đang lưu…') : text('Save', 'Lưu')}
            </button>
            <button type="button" className="secondary sm" disabled={renaming} onClick={cancelRename}>
              {text('Cancel', 'Hủy')}
            </button>
          </div>
          {renameError && <p role="alert" className="reader-rename-error">{renameError}</p>}
        </form>
      )}

      {pickerOpen && pickerPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={pickerPopoverRef}
          className="reader-popover reader-picker-popover"
          style={{
            top: pickerPosition.top,
            left: pickerPosition.left,
            width: pickerPosition.width,
          }}
          onKeyDown={handlePickerKeyDown}
        >
          <div className="reader-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              aria-label={text('Search documents', 'Tìm tài liệu')}
              placeholder={text('Search documents…', 'Tìm kiếm tài liệu…')}
              autoComplete="off"
              onChange={event => setSearchQuery(event.currentTarget.value)}
            />
          </div>
          <div
            id={pickerListId}
            role="listbox"
            aria-label={text('Workspace documents', 'Tài liệu trong workspace')}
            className="reader-picker-list"
            style={{ maxHeight: Math.max(120, pickerPosition.maxHeight - 48) }}
          >
            {filteredDocuments.length > 0 ? filteredDocuments.map((doc, idx) => {
              const isSelected = doc.document_id === selectedDoc?.document_id
              const isHighlighted = idx === highlightIndex
              return (
                <button
                  key={doc.document_id}
                  ref={el => { optionRefs.current[idx] = el }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-highlighted={isHighlighted ? 'true' : undefined}
                  className="reader-picker-option"
                  title={doc.filename !== doc.name ? `${doc.name} (${doc.filename})` : doc.name}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => {
                    onSelect(doc.document_id)
                    closePicker(true)
                  }}
                >
                  <FileText size={13} className="reader-picker-option-icon" aria-hidden="true" />
                  <span className="reader-picker-option-copy">
                    <span className="reader-picker-option-name">{doc.name}</span>
                    {doc.filename !== doc.name && (
                      <span className="reader-picker-option-sub">{doc.filename}</span>
                    )}
                  </span>
                  {!doc.preview_ready && (
                    <span className="badge badge-info">{text('Preparing', 'Đang tạo')}</span>
                  )}
                  {isSelected && <Check size={13} className="reader-picker-option-check" aria-hidden="true" />}
                </button>
              )
            }) : (
              <p className="reader-picker-empty" role="status">
                {text('No matching documents.', 'Không tìm thấy tài liệu phù hợp.')}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}

      {menuOpen && menuPosition && selectedDoc && mayWrite && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuPopoverRef}
          id={menuId}
          role="menu"
          aria-label={text('Document actions', 'Thao tác tài liệu')}
          className="reader-popover reader-actions-popover"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            minWidth: menuPosition.width,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            ref={el => { menuItemRefs.current[0] = el }}
            type="button"
            role="menuitem"
            className="reader-menu-item"
            disabled={busy || annotationPending}
            onClick={openRenameForm}
          >
            <Edit3 size={14} aria-hidden="true" />
            <span>{text('Rename', 'Đổi tên')}</span>
          </button>
          <button
            ref={el => { menuItemRefs.current[1] = el }}
            type="button"
            role="menuitem"
            className="reader-menu-item reader-menu-danger"
            disabled={busy || annotationPending}
            onClick={() => {
              closeMenu(false)
              onDelete(selectedDoc)
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span>{text('Delete document', 'Xóa tài liệu')}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
