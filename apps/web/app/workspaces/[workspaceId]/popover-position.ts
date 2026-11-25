export type PopoverPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

export function computePopoverPosition(
  anchor: HTMLElement,
  desiredWidth: number,
  alignRight: boolean,
  preferredHeight: number,
): PopoverPosition {
  const rect = anchor.getBoundingClientRect()
  const margin = 8
  const gap = 4
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(desiredWidth, Math.max(150, viewportWidth - margin * 2))

  let left = alignRight ? rect.right - width : rect.left
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin))

  const spaceBelow = viewportHeight - rect.bottom - margin - gap
  const spaceAbove = rect.top - margin - gap
  const placeAbove = spaceBelow < Math.min(preferredHeight, 160) && spaceAbove > spaceBelow
  const availableHeight = Math.max(100, placeAbove ? spaceAbove : spaceBelow)
  const maxHeight = Math.min(preferredHeight, availableHeight)
  const top = placeAbove ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap

  return { top, left, width, maxHeight }
}
