import { useRef, useState } from 'react'
import type { NoteEntity } from '../../data/persistence'
import Checkbox from '../../shared/ui/Checkbox'
import Disclosure from '../../shared/ui/Disclosure'
import { setNoteChatSkill } from '../chat/chat-skills'
import { setNoteTemplateOptions } from '../codex/codex-templates'
import { useLoreTypes } from '../codex/LoreTypesControls'

export default function NoteRoleControls({ note, onChange }: { note: NoteEntity; onChange: (note: NoteEntity) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const { types } = useLoreTypes(note.bookId)
  const compatible = note.compatibleLoreTypeIds ?? []

  async function save(action: () => Promise<NoteEntity>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      onChange(await action())
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return <section className="document-metadata note-roles" aria-label="Note roles">
    <Checkbox label="Use as chat skill" description="Select this skill explicitly from a chat’s Skills picker." checked={note.useAsChatSkill === true} disabled={busy} onChange={event => { const enabled = event.target.checked; void save(() => setNoteChatSkill(note.bookId, note.id, enabled)) }} />
    <Checkbox label="Use as Codex template" description="Allow this Note to provide starter Markdown for new Codex entries." checked={note.useAsCodexTemplate === true} disabled={busy} onChange={event => { const enabled = event.target.checked; void save(() => setNoteTemplateOptions(note.bookId, note.id, { useAsCodexTemplate: enabled })) }} />
    {note.useAsCodexTemplate && <Disclosure className="note-template-types-disclosure" title="Compatible lore types" description={compatible.length ? `${compatible.length} selected` : 'Any type'}>
      <p>No selection means any type. Applying a template copies its Markdown into an empty entry without changing the entry title or type.</p>
      <div className="note-template-types">{types.map(type => <Checkbox key={type.id} label={type.name} checked={compatible.includes(type.id)} disabled={busy} onChange={event => { const ids = event.target.checked ? [...compatible, type.id] : compatible.filter(id => id !== type.id); void save(() => setNoteTemplateOptions(note.bookId, note.id, { compatibleLoreTypeIds: ids })) }} />)}{compatible.filter(id => !types.some(type => type.id === id)).map(id => <Checkbox key={id} label={`Unavailable type (${id})`} checked disabled={busy} onChange={() => { void save(() => setNoteTemplateOptions(note.bookId, note.id, { compatibleLoreTypeIds: compatible.filter(item => item !== id) })) }} />)}</div>
    </Disclosure>}
    {error && <p className="note-role-error" role="alert">{error}</p>}
  </section>
}
