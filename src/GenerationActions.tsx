import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, Play, X } from 'lucide-react'

type Action = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  pressed?: boolean
}

/** Shared by Chat, the floating editor control, and the instruction drawer. */
export default function GenerationActions({ label, onGenerate, actions }: {
  label: string
  onGenerate: () => void
  actions: Action[]
}) {
  const [open, setOpen] = useState(false)
  const [pressing, setPressing] = useState(false)
  const [selected, setSelected] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
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
    if (restoreFocus) primaryRef.current?.focus()
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

  function focusFirstAction() {
    setOpen(true)
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.generation-action-row:not(:disabled)')?.focus())
  }

  return <div ref={rootRef} className="generation-actions" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
  }}>
    {open && <div className="generation-action-popover" id={panelId} role="group" aria-label={`${label} actions`}>
      <div className="generation-action-heading"><span>Quick actions</span><button type="button" onClick={() => close(true)} aria-label="Close quick actions"><X aria-hidden="true" /></button></div>
      {actions.map((action) => <button key={action.id} type="button"
        className={`generation-action-row ${selected === action.id ? 'just-selected' : ''}`}
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
        {action.icon}<span>{action.label}</span>
        {action.pressed !== undefined && <span className="generation-action-state">{action.pressed ? <Check aria-hidden="true" /> : 'Off'}</span>}
      </button>)}
    </div>}
    <button ref={primaryRef} type="button" className={`play generation-primary ${pressing ? 'pressing' : ''}`} aria-label={label}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      aria-description="Hold or press Arrow Up for quick actions."
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        heldRef.current = false
        cancelHold()
        setPressing(true)
        holdRef.current = setTimeout(() => { heldRef.current = true; setPressing(false); setOpen(true) }, 450)
      }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') { event.preventDefault(); cancelHold(); focusFirstAction() }
      }}
      onClick={() => {
        if (heldRef.current) { heldRef.current = false; return }
        close()
        onGenerate()
      }}><Play aria-hidden="true" fill="currentColor" /><span>{label}</span></button>
  </div>
}
