import { useEffect, useRef, useState } from 'react'
import './codex-entry-title.css'

export default function CodexEntryTitle({ title, disabled, readOnly, onSave }: {
  title: string
  disabled: boolean
  readOnly: boolean
  onSave: (title: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const cancelRef = useRef(false)


  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  async function save() {
    if (draft === null || cancelRef.current || savingRef.current || disabled || readOnly) return
    const next = draft.trim()
    if (!next) { setError('Enter an entry name.'); return }
    if (next === title) { setDraft(null); setError(''); return }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await onSave(next)
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the entry name.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return <div className="codex-entry-title">
    <h1>{editing && !readOnly ? <input ref={inputRef} className="codex-entry-title__input" aria-label="Codex entry name" aria-invalid={Boolean(error)} aria-describedby={error ? 'codex-title-error' : undefined} value={draft} disabled={disabled || saving} onChange={event => { setDraft(event.target.value); setError('') }} onBlur={() => { void save() }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); void save() }
      if (event.key === 'Escape') { event.preventDefault(); cancelRef.current = true; setDraft(null); setError('') }
    }} /> : readOnly ? title : <button type="button" className="codex-entry-title__button" disabled={disabled || saving} aria-label={`Edit entry name: ${title}`} title="Click to edit name" onClick={() => { cancelRef.current = false; setDraft(title) }}>{title}</button>}</h1>
    {editing && <span className="codex-entry-title__hint" role="status">{saving ? 'Saving…' : 'Saves on Enter or when you leave the field · Esc to cancel'}</span>}
    {error && <span id="codex-title-error" className="codex-entry-title__error" role="alert">{error}</span>}
  </div>
}
