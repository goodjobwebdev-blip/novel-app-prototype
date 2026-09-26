import { useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type CodexAction = { label: string; onSelect: () => void; disabled?: boolean }

export default function CodexActionsMenu({ title, open, onToggle, onClose, actions }: {
  title: string; open: boolean; onToggle: () => void; onClose: () => void; actions: CodexAction[]
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const closeAndFocus = () => { trigger.current?.focus(); onClose() }
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return
    const panel = menu.current, anchor = trigger.current
    const position = () => {
      const viewport = window.visualViewport
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0
      const viewportWidth = viewport?.width ?? window.innerWidth, viewportHeight = viewport?.height ?? window.innerHeight
      const rect = anchor.getBoundingClientRect(), margin = 8, gap = 4
      const width = Math.min(224, viewportWidth - margin * 2)
      panel.style.width = `${width}px`
      const below = viewportTop + viewportHeight - rect.bottom - margin - gap
      const above = rect.top - viewportTop - margin - gap
      const height = panel.scrollHeight + 2
      const placeBelow = below >= height || below >= above
      const maxHeight = Math.max(0, Math.min(viewportHeight - margin * 2, placeBelow ? below : above))
      const left = Math.max(viewportLeft + margin, Math.min(rect.right - width, viewportLeft + viewportWidth - width - margin))
      const top = Math.max(viewportTop + margin, placeBelow ? rect.bottom + gap : rect.top - gap - Math.min(height, maxHeight))
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, maxHeight: `${maxHeight}px` })
    }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) onClose()
    }
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.contains(event.target)) onClose() }
    position()
    ;(panel.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panel).focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', onClose)
    }
  }, [open, onClose])
  return <>
    <button ref={trigger} className="codex-actions-trigger" type="button" aria-label={`Actions for ${title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) onToggle() }
    }}><MoreHorizontal aria-hidden="true" /><span>Actions</span></button>
    {open && createPortal(<div ref={menu} id={id} className="codex-actions-popover" role="menu" tabIndex={-1} aria-label={`Actions for ${title}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAndFocus(); return }
      if (event.key === 'Tab') { closeAndFocus(); return }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
      if (next >= 0) { event.preventDefault(); items[next]?.focus() }
    }}>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1} disabled={action.disabled} onClick={() => { closeAndFocus(); action.onSelect() }}>{action.label}</button>)}
    </div>, document.body)}
  </>
}
