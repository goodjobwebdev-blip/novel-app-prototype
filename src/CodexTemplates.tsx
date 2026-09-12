import { useEffect, useRef, useState, type RefObject } from 'react'
import type { MarkdownEditorHandle } from './MarkdownEditor'
import type { NoteEntity } from './persistence'
import { applyCodexTemplate, listCodexTemplates } from './codex-templates'
export default function CodexTemplates({ bookId, targetId, typeId, body, editor, disabled, sharedSource = false }: { bookId: string; targetId: string; typeId: string; body: string; editor: RefObject<MarkdownEditorHandle | null>; disabled?: boolean; sharedSource?: boolean }) {
  const [notes, setNotes] = useState<NoteEntity[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [applied, setApplied] = useState('')
  const alive = useRef(true), busyRef = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    const load = () => { void listCodexTemplates(bookId, typeId).then(value => { if (active) setNotes(value) }).catch(reason => { if (active) setError(reason.message) }) }
    load(); window.addEventListener('arc-entity-changed', load); window.addEventListener('arc-lore-types-changed', load); window.addEventListener('focus', load)
    return () => { active = false; window.removeEventListener('arc-entity-changed', load); window.removeEventListener('arc-lore-types-changed', load); window.removeEventListener('focus', load) }
  }, [bookId, typeId])
  const note = notes.find(item => item.id === selected)
  async function apply() {
    if (busyRef.current || disabled || !note) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const template = await applyCodexTemplate({ bookId, noteId: note.id, targetId, typeId, sharedSource }, () => editor.current)
      if (alive.current) setApplied(template.title)
    } catch (reason) { if (alive.current) setError((reason as Error).message) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  return <details className="codex-templates" open={!body.trim()}><summary>Codex templates</summary>
    {body.trim() ? <p>Templates apply only to an empty body. Clear the body explicitly before applying a template.</p> : <>
      <p>Copy a compatible Note from this book. The copy stays independent and can be undone.</p>{sharedSource && <p>This changes the shared editor draft. Save series changes explicitly to publish it to inheriting books.</p>}
      <label>Template Note<select className="lore-type-select" aria-label="Codex template Note" disabled={busy || disabled} value={note ? selected : ''} onChange={event => { setSelected(event.target.value); setError(''); setApplied('') }}><option value="">Choose a template…</option>{notes.map(item => <option key={item.id} value={item.id}>{item.title}{!item.content.trim() ? ' · empty' : ''}</option>)}</select></label>
      {!notes.length && <p>Mark a Note “Use as Codex template” to add one. Its compatible types must include this entry’s type, or be left empty for any type.</p>}
      {note && <details><summary>Template preview</summary><pre>{note.content || 'This template is empty.'}</pre></details>}
      <button type="button" disabled={busy || disabled || !note?.content.trim()} onClick={() => { void apply() }}>{busy ? 'Applying…' : 'Apply template'}</button>
    </>}{applied && <p role="status">Applied “{applied}”. Undo restores the empty body.</p>}{error && <p role="alert">{error}</p>}
  </details>
}
