import { useEffect, useRef, useState } from 'react'
import type { BookEntity, WorldEntity } from '../../data/persistence'
import { listWorlds } from './world-service'
import Select from '../../shared/ui/Select'
import Button from '../../shared/ui/Button'

export default function BookWorldSelector({ book, onChange, onOpen }: {
  book: BookEntity
  onChange: (worldId: string) => Promise<void>
  onOpen: (worldId?: string) => void
}) {
  const [worlds, setWorlds] = useState<WorldEntity[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    alive.current = true
    let request = 0
    const load = async () => {
      const version = ++request
      try {
        const worlds = await listWorlds()
        if (alive.current && version === request) { setWorlds(worlds); setError('') }
      } catch (cause) { if (alive.current && version === request) setError((cause as Error).message) }
    }
    void load()
    window.addEventListener('arc-worlds-changed', load)
    return () => { alive.current = false; ++request; window.removeEventListener('arc-worlds-changed', load) }
  }, [])
  const change = async (worldId: string) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onChange(worldId) }
    catch (cause) { if (alive.current) setError((cause as Error).message) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return <div className="book-world-selector">
    <Select label="World" aria-label="Book World" value={book.worldId ?? ''} disabled={busy} onChange={event => { void change(event.target.value) }}>
      <option value="">No World · book-only Codex</option>
      {worlds.map(world => <option key={world.id} value={world.id}>{world.title}</option>)}
      {book.worldId && !worlds.some(world => world.id === book.worldId) && <option value={book.worldId}>Loading linked World…</option>}
    </Select>
    <small>World entries appear alongside this Book’s local Codex. Editing a World entry changes it for every linked Book. Changing this link does not copy or delete World entries.</small>
    <Button size="small" variant="ghost" disabled={busy} onClick={() => onOpen(book.worldId)}>Open World Building</Button>
    {busy && <p role="status">Updating World link…</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
