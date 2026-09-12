import { useRef, useState } from 'react'
import type { NoteEntity } from './persistence'
import { setNoteChatSkill } from './chat-skills'
import { setNoteTemplateOptions } from './codex-templates'
import { useLoreTypes } from './LoreTypesControls'
export default function NoteRoleControls({ note, onChange }: { note: NoteEntity; onChange: (note: NoteEntity) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const busyRef = useRef(false), { types } = useLoreTypes(note.bookId)
  const compatible = note.compatibleLoreTypeIds ?? []
  async function save(action: () => Promise<NoteEntity>) { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { onChange(await action()) } catch (reason) { setError((reason as Error).message) } finally { busyRef.current = false; setBusy(false) } }
  return <div className="document-metadata note-roles">
    <label><input type="checkbox" checked={note.useAsChatSkill === true} disabled={busy} onChange={event => { const enabled = event.target.checked; void save(() => setNoteChatSkill(note.bookId, note.id, enabled)) }} /><span>Use as chat skill</span></label><small>Select a skill explicitly in a chat’s Skills picker.</small>
    <label><input type="checkbox" checked={note.useAsCodexTemplate === true} disabled={busy} onChange={event => { const enabled = event.target.checked; void save(() => setNoteTemplateOptions(note.bookId, note.id, { useAsCodexTemplate: enabled })) }} /><span>Use as Codex template</span></label>
    {note.useAsCodexTemplate && <details><summary>Compatible lore types · {compatible.length ? compatible.length : 'any type'}</summary><p>No selection means any type. Applying copies textual Markdown into an empty entry; it does not change its title or type.</p><div className="note-template-types">{types.map(type => <label key={type.id}><input type="checkbox" checked={compatible.includes(type.id)} disabled={busy} onChange={event => { const ids = event.target.checked ? [...compatible, type.id] : compatible.filter(id => id !== type.id); void save(() => setNoteTemplateOptions(note.bookId, note.id, { compatibleLoreTypeIds: ids })) }} />{type.name}</label>)}{compatible.filter(id => !types.some(type => type.id === id)).map(id => <label key={id}><input type="checkbox" checked disabled={busy} onChange={() => { void save(() => setNoteTemplateOptions(note.bookId, note.id, { compatibleLoreTypeIds: compatible.filter(item => item !== id) })) }} />Unavailable type ({id})</label>)}</div></details>}
    {error && <p role="alert">{error}</p>}
  </div>
}
