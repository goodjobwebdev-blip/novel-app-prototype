import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { centeredImageView, imageFrame, moveImage, pinchChange, type ImageView, type Point, type Size } from './image-gestures'

export default function IllustrationGestures({ src, alt, image, value, onChange, crop = false, disabled = false }: {
  src: string; alt: string; image: Size; value: ImageView; onChange: (view: ImageView) => void; crop?: boolean; disabled?: boolean
}) {
  const surface = useRef<HTMLDivElement>(null)
  const points = useRef(new Map<number, Point>())
  const latest = useRef(value)
  latest.current = value
  const [viewport, setViewport] = useState<Size>({ width: 1, height: 1 })
  useEffect(() => {
    const element = surface.current!
    const resize = () => setViewport({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) })
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => { observer.disconnect(); points.current.clear() }
  }, [])
  useEffect(() => { if (disabled) points.current.clear() }, [disabled])
  const frame = imageFrame(image, viewport, crop, value)
  function update(next: ImageView) { latest.current = next; onChange(next) }
  function position(event: PointerEvent) {
    const rect = surface.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || points.current.size >= 2) return
    points.current.set(event.pointerId, position(event))
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !points.current.has(event.pointerId)) return
    const old = [...points.current.values()]
    const prior = points.current.get(event.pointerId)!
    const next = position(event)
    points.current.set(event.pointerId, next)
    if (points.current.size === 2) {
      const pinch = pinchChange(old, [...points.current.values()])
      update(moveImage(image, viewport, crop, latest.current, pinch.delta, latest.current.zoom * pinch.ratio, pinch.anchor))
    } else update(moveImage(image, viewport, crop, latest.current, { x: next.x - prior.x, y: next.y - prior.y }))
  }
  const end = (event: PointerEvent) => { points.current.delete(event.pointerId) }
  const zoom = (amount: number) => update(moveImage(image, viewport, crop, latest.current, { x: 0, y: 0 }, latest.current.zoom + amount))
  return <div className={`image-gesture ${crop ? 'image-gesture-crop' : 'image-gesture-view'}`}>
    <div ref={surface} className="image-gesture-surface" tabIndex={disabled ? -1 : 0} role="group" aria-label={crop ? 'Thumbnail crop. Drag to position; pinch or use zoom buttons. Arrow keys move the image.' : 'Image viewer. Pinch or use zoom buttons; drag to pan. Arrow keys move the image.'}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (disabled) return
        const steps: Record<string, Point> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } }
        if (steps[event.key]) { event.preventDefault(); update(moveImage(image, viewport, crop, latest.current, steps[event.key])) }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(.25) }
        if (event.key === '-') { event.preventDefault(); zoom(-.25) }
      }}>
      <img src={src} alt={alt} draggable={false} style={{ width: frame.width, height: frame.height, transform: `translate(-50%, -50%) translate(${frame.panX}px, ${frame.panY}px) scale(${value.zoom})` }} />
      {crop && <span className="image-crop-grid" aria-hidden="true" />}
    </div>
    <div className="image-zoom-controls"><button type="button" disabled={disabled || value.zoom <= 1} onClick={() => zoom(-.25)} aria-label="Zoom out"><Minus aria-hidden="true" /></button><output aria-label="Zoom level">{Math.round(value.zoom * 100)}%</output><button type="button" disabled={disabled || value.zoom >= 4} onClick={() => zoom(.25)} aria-label="Zoom in"><Plus aria-hidden="true" /></button><button type="button" disabled={disabled} onClick={() => update({ ...centeredImageView })}><RotateCcw aria-hidden="true" />Reset</button></div>
  </div>
}
