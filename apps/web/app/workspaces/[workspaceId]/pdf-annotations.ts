import type { Region } from './pdf-preview'
export type Point = { x: number; y: number }
export type Box = Point & { width: number; height: number }
export type Quad = {
  upperLeft: Point
  upperRight: Point
  lowerLeft: Point
  lowerRight: Point
}
export type Snapshot = {
  version: 1
  subtype: 'highlight' | 'square' | 'text'
  rect: Box
  quadPoints: Quad[]
  color: string
  opacity: number
}
export type PersonalAnnotation = {
  annotation_id: string
  page: number
  body: string
  region: Region | null
  regions?: Region[]
  embedpdf?: Snapshot | null
}
export type AnnotationInput = Omit<PersonalAnnotation, 'annotation_id'>

// Legacy anchors use the displayed, intrinsic-rotation frame. SDK geometry is
// upright crop-relative page space. Extra reader rotation never changes storage.
export function turnRegion(r: Region, angle: number): Region {
  const [l, t, x, b] = r
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return [1 - b, l, 1 - t, x]
    case 180:
      return [1 - x, 1 - b, 1 - l, 1 - t]
    case 270:
      return [t, 1 - x, b, 1 - l]
    default:
      return r
  }
}
export function legacyBox(r: Region, width: number, height: number, intrinsic: number): Box {
  const [l, t, x, b] = turnRegion(r, -intrinsic)
  return {
    x: l * width,
    y: t * height,
    width: (x - l) * width,
    height: (b - t) * height
  }
}
export function legacyRegions(
  snapshot: Snapshot,
  width: number,
  height: number,
  intrinsic: number
): Region[] {
  const quads = snapshot.quadPoints.length
    ? snapshot.quadPoints
    : [
        {
          upperLeft: snapshot.rect,
          upperRight: {
            x: snapshot.rect.x + snapshot.rect.width,
            y: snapshot.rect.y
          },
          lowerLeft: {
            x: snapshot.rect.x,
            y: snapshot.rect.y + snapshot.rect.height
          },
          lowerRight: {
            x: snapshot.rect.x + snapshot.rect.width,
            y: snapshot.rect.y + snapshot.rect.height
          }
        }
      ]
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return quads
    .map((q) => {
      const p = Object.values(q)
      return turnRegion(
        [
          clamp(Math.min(...p.map((v) => v.x)) / width),
          clamp(Math.min(...p.map((v) => v.y)) / height),
          clamp(Math.max(...p.map((v) => v.x)) / width),
          clamp(Math.max(...p.map((v) => v.y)) / height)
        ],
        intrinsic
      )
    })
    .filter((r) => r[0] < r[2] && r[1] < r[3])
}

// Keep persisted geometry within the visible crop. Glyph bounds may extend
// beyond it; clipping here preserves the backend's non-negative validation.
export function cropSnapshot(snapshot: Snapshot, width: number, height: number): Snapshot {
  const point = (p: Point): Point => ({
    x: Math.max(0, Math.min(width, p.x)),
    y: Math.max(0, Math.min(height, p.y))
  })
  const a = point(snapshot.rect)
  const b = point({ x: snapshot.rect.x + snapshot.rect.width, y: snapshot.rect.y + snapshot.rect.height })
  return {
    ...snapshot,
    rect: { ...a, width: b.x - a.x, height: b.y - a.y },
    quadPoints: snapshot.quadPoints.map((q) => ({
      upperLeft: point(q.upperLeft),
      upperRight: point(q.upperRight),
      lowerLeft: point(q.lowerLeft),
      lowerRight: point(q.lowerRight)
    }))
  }
}
