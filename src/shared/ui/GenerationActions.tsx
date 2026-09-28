import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Ellipsis, Play, X } from 'lucide-react'

type Action = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  pressed?: boolean
}

/** Shared by Chat, the floating editor control, and the instruction drawer. */
export default function GenerationActions({ label, onGenerate, actions, menuOnly = false, menuAlign = 'end' }: {
  label: string
  menuOnly?: boolean
  menuAlign?: 'start' | 'end'
  onGenerate: () => void
  actions: Action[]
}) {
  const [open, setOpen] = useState(false)
  const [pressing, setPressing] = useState(false)
  const [selected, setSelected] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const panelId = useId()

  function cancelHold() {
    if (holdRef.current) clearTimeout(holdRef.current)
    holdRef.current = null
    setPressing(false)
  }

  function close(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) openerRef.current?.focus()
  }

  useEffect(() => () => {
    if (holdRef.current) clearTimeout(holdRef.current)
    if (feedbackRef.current) clearTimeout(feedbackRef.current)
  }, [])

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  function focusFirstAction(opener: HTMLButtonElement | null = primaryRef.current) {
    openerRef.current = opener
    setOpen(true)
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.generation-action-row:not(:disabled)')?.focus())
  }

  return <div ref={rootRef} className={`generation-actions generation-actions--menu-${menuAlign}`} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
  }}>
    {open && <div className="generation-action-popover" id={panelId} role="group" aria-label={`${label} actions`}>
      <div className="generation-action-heading"><span>Quick actions</span><button type="button" onClick={() => close(true)} aria-label="Close quick actions"><X aria-hidden="true" /></button></div>
      <div className="generation-action-list">
        {actions.map((action, index) => <button key={action.id} type="button"
          className={`generation-action-row ${selected === action.id ? 'just-selected' : ''}`}
          style={{ '--action-curve-offset': `${Math.max(0, 72 - index * 18)}px` } as CSSProperties}
          disabled={action.disabled} aria-pressed={action.pressed}
          onClick={() => {
            setSelected(action.id)
            if (feedbackRef.current) clearTimeout(feedbackRef.current)
            feedbackRef.current = setTimeout(() => {
              setSelected('')
              if (action.pressed === undefined) close(true)
            }, 180)
            action.onSelect()
          }}>
          <span className="generation-action-icon">{action.icon}</span><span className="generation-action-label">{action.label}</span>
          {action.pressed !== undefined && <span className="generation-action-state">{action.pressed ? <Check aria-hidden="true" /> : 'Off'}</span>}
        </button>)}
      </div>
    </div>}
    {!menuOnly && <button ref={menuRef} type="button" className="generation-more" aria-label={`Open ${label} actions`} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => open ? close(true) : focusFirstAction(menuRef.current)}><Ellipsis aria-hidden="true" /></button>}
    <button ref={primaryRef} type="button" className={`play generation-primary ${pressing ? 'pressing' : ''}`} aria-label={label}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      aria-description="Hold or press Arrow Up for quick actions."
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.pointerType === 'mouse') return
        heldRef.current = false
        cancelHold()
        setPressing(true)
        holdRef.current = setTimeout(() => { heldRef.current = true; openerRef.current = primaryRef.current; setPressing(false); setOpen(true) }, 450)
      }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); cancelHold(); focusFirstAction() }
      }}
      onClick={() => {
        if (heldRef.current) { heldRef.current = false; return }
        if (menuOnly) { focusFirstAction(); return }
        close()
        onGenerate()
      }}><Play aria-hidden="true" fill="currentColor" /><span>{label}</span></button>
  </div>
}
