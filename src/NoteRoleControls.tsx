import { useState } from 'react'
import type { NoteEntity } from './persistence'
import { setNoteChatSkill } from './chat-skills'
export default function NoteRoleControls({ note, onChange }: { note: NoteEntity; onChange: (note: NoteEntity) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <div className="document-metadata note-roles"><label><input type="checkbox" checked={note.useAsChatSkill === true} disabled={busy} onChange={event => {
    setBusy(true); setError(''); void setNoteChatSkill(note.bookId, note.id, event.target.checked).then(onChange).catch(reason => setError(reason.message)).finally(() => setBusy(false))
  }} /><span>Use as chat skill</span></label><small>Select it explicitly in a chat’s Skills picker.</small>{error && <p role="alert">{error}</p>}</div>
}
