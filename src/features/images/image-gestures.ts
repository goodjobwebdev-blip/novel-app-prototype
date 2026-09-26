/** Shared geometry for touch cropping and the full-screen viewer. */
export type ImageView = { x: number; y: number; zoom: number }
export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export const centeredImageView: ImageView = { x: 50, y: 50, zoom: 1 }
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function imageFrame(image: Size, viewport: Size, cover: boolean, view: ImageView) {
  const scale = (cover ? Math.max : Math.min)(viewport.width / image.width, viewport.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const overflowX = Math.max(0, width * view.zoom - viewport.width)
  const overflowY = Math.max(0, height * view.zoom - viewport.height)
  return { width, height, overflowX, overflowY, panX: (50 - view.x) / 100 * overflowX, panY: (50 - view.y) / 100 * overflowY }
}

export function moveImage(image: Size, viewport: Size, cover: boolean, view: ImageView, delta: Point, zoom = view.zoom, anchor: Point = { x: viewport.width / 2, y: viewport.height / 2 }): ImageView {
  const nextZoom = clamp(zoom, 1, 4)
  const before = imageFrame(image, viewport, cover, view)
  const after = imageFrame(image, viewport, cover, { ...view, zoom: nextZoom })
  const ratio = nextZoom / view.zoom
  const panX = (before.panX - (anchor.x - viewport.width / 2)) * ratio + (anchor.x - viewport.width / 2) + delta.x
  const panY = (before.panY - (anchor.y - viewport.height / 2)) * ratio + (anchor.y - viewport.height / 2) + delta.y
  return {
    zoom: nextZoom,
    x: after.overflowX ? clamp(50 - panX / after.overflowX * 100, 0, 100) : 50,
    y: after.overflowY ? clamp(50 - panY / after.overflowY * 100, 0, 100) : 50,
  }
}

export function pinchChange(previous: Point[], next: Point[]) {
  const midpoint = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 })
  const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  const anchor = midpoint(previous)
  const center = midpoint(next)
  return { anchor, delta: { x: center.x - anchor.x, y: center.y - anchor.y }, ratio: distance(next) / Math.max(1, distance(previous)) }
}
