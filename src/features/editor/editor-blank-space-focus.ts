import { EditorView } from '@codemirror/view'

export function installBlankSpaceFocus(view: EditorView, host: HTMLElement) {
  let press: { pointerId: number; x: number; y: number; released: boolean } | null = null
  const clearPress = () => { press = null }
  const isBlankSpace = (event: MouseEvent) => {
    if (view.state.readOnly || !view.state.facet(EditorView.editable) || view.composing
      || event.button !== 0 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
    // Only bare editor surfaces qualify, never text, widgets, or their controls.
    if (![host, view.dom, view.scrollDOM, view.contentDOM].some(element => event.target === element)) return false
    return event.clientY >= view.documentTop + view.lineBlockAt(view.state.doc.length).bottom
  }
  const pointerDown = (event: PointerEvent) => {
    press = event.isPrimary !== false && isBlankSpace(event)
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, released: false } : null
  }
  const pointerMove = (event: PointerEvent) => {
    if (press && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) clearPress()
  }
  const pointerUp = (event: PointerEvent) => {
    pointerMove(event)
    if (press && event.pointerId === press.pointerId) press.released = true
  }
  const pointerLeave = () => {
    // Non-hover pointers leave after pointerup, before the synthesized click.
    if (!press?.released) clearPress()
  }
  const click = (event: MouseEvent) => {
    const start = press
    clearPress()
    if (!start?.released || event.defaultPrevented || event.detail > 1 || !isBlankSpace(event)
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.length }, userEvent: 'select.pointer' })
  }

  host.addEventListener('pointerdown', pointerDown)
  host.addEventListener('pointermove', pointerMove)
  host.addEventListener('pointerup', pointerUp)
  host.addEventListener('pointercancel', clearPress)
  host.addEventListener('pointerleave', pointerLeave)
  host.addEventListener('click', click)
  // A scroll can occur without pointer movement (e.g. a trackpad gesture).
  window.addEventListener('scroll', clearPress, true)
  return () => {
    host.removeEventListener('pointerdown', pointerDown)
    host.removeEventListener('pointermove', pointerMove)
    host.removeEventListener('pointerup', pointerUp)
    host.removeEventListener('pointercancel', clearPress)
    host.removeEventListener('pointerleave', pointerLeave)
    host.removeEventListener('click', click)
    window.removeEventListener('scroll', clearPress, true)
  }
}
