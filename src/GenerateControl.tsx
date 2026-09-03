import { useEffect, useRef, useState } from 'react'

type GenerateControlProps = {
  onGenerate: () => void
  onMicro: () => void
  onMicro2: () => void
  onUndo: () => void
  onRedo: () => void
  onRegenerate: () => void
}

export default function GenerateControl({ onGenerate, onMicro, onMicro2, onUndo, onRedo, onRegenerate }: GenerateControlProps) {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const longPressRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function runAction(event: React.PointerEvent<HTMLButtonElement>, action: () => void, collapse = false) {
    event.preventDefault()
    event.stopPropagation()
    action()
    if (collapse) setExpanded(false)
  }

  useEffect(() => {
    if (!expanded) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      setExpanded(false)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [expanded])

  if (expanded) {
    return <div ref={rootRef} className="generate-actions" role="toolbar" aria-label="Generate actions">
      <button type="button" onPointerDown={(event) => runAction(event, onMicro)} aria-label="Insert speech placeholder into editor" title="Micro">🎙</button>
      <button type="button" onPointerDown={(event) => runAction(event, onMicro2)} aria-label="Insert speech placeholder into generation input" title="Micro 2">🎤</button>
      <button type="button" onPointerDown={(event) => runAction(event, onUndo)} aria-label="Undo editor change" title="Back / Undo">↶</button>
      <button type="button" onPointerDown={(event) => runAction(event, onRedo)} aria-label="Redo editor change" title="Forward / Redo">↷</button>
      <button type="button" onPointerDown={(event) => runAction(event, onRegenerate)} aria-label="Regenerate latest result" title="Regenerate">⟳</button>
      <button type="button" onPointerDown={(event) => runAction(event, () => setExpanded(false))} aria-label="Collapse generate actions" title="Collapse">×</button>
    </div>
  }

  return <button
    className="play generate-trigger"
    type="button"
    aria-label="Generate. Press and hold for more actions."
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={() => {
      longPressRef.current = false
      cancelTimer()
      timerRef.current = setTimeout(() => {
        longPressRef.current = true
        setExpanded(true)
      }, 450)
    }}
    onPointerUp={() => {
      cancelTimer()
      if (!longPressRef.current) onGenerate()
    }}
    onPointerCancel={cancelTimer}
    onPointerLeave={cancelTimer}
    onClick={(event) => { if (event.detail === 0) onGenerate() }}
  >▶</button>
}
