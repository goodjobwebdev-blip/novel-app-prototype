import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import { type NoteEntity } from '../../data/persistence'
import { copyStarterChatSkill, listSkillNotes, skillFromNote, starterChatSkills } from './chat-skills'
import { updateChat, type ChatEntity } from './chat-service'

export default function ChatSkillsPicker({ chat, onChange }: { chat: ChatEntity; onChange: (chat: ChatEntity) => void }) {
  const [notes, setNotes] = useState<NoteEntity[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const selected = [...new Set(chat.skillNoteIds ?? [])]
  useEffect(() => {
    let active = true
    const reload = () => { void listSkillNotes(chat.bookId).then(next => { if (active) setNotes(next) }).catch(() => { if (active) setError('Notes could not be loaded.') }) }
    reload(); window.addEventListener('arc-entity-changed', reload)
    return () => { active = false; window.removeEventListener('arc-entity-changed', reload) }
  }, [chat.bookId, chat.updatedAt])
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await task() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Skills could not be saved.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const save = (ids: string[]) => run(async () => onChange(await updateChat(chat.id, { skillNoteIds: ids })))
  function move(index: number, delta: number) { const ids = [...selected]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; void save(ids) }
  return <details className="chat-skills"><summary>Skills · {selected.length} selected</summary>
    <p>Skills apply in this order to the next request. Selection never sends a message. Missing, empty, or unmarked Notes are skipped.</p>
    <ol>{selected.map((id, index) => { const note = notes.find(item => item.id === id); return <li key={id}><span>{note?.title ?? `Missing Note (${id})`}{(!note || !skillFromNote(note)) && <small> · unavailable</small>}</span><Button className="chat-icon-action" size="small" variant="ghost" disabled={busy || index === 0} aria-label={`Move ${note?.title ?? 'missing skill'} up`} leadingIcon={<ArrowUp />} onClick={() => move(index, -1)} /><Button className="chat-icon-action" size="small" variant="ghost" disabled={busy || index === selected.length - 1} aria-label={`Move ${note?.title ?? 'missing skill'} down`} leadingIcon={<ArrowDown />} onClick={() => move(index, 1)} /><Button size="small" variant="ghost" disabled={busy} onClick={() => { void save(selected.filter(item => item !== id)) }}>Remove</Button></li> })}</ol>
    {notes.filter(note => note.useAsChatSkill).map(note => <Checkbox key={note.id} label={`${note.title}${!skillFromNote(note) ? ' · empty' : ''}`} disabled={busy || (!selected.includes(note.id) && !skillFromNote(note))} checked={selected.includes(note.id)} onChange={event => { void save(event.target.checked ? [...selected, note.id] : selected.filter(id => id !== note.id)) }} />)}
    {!notes.some(note => note.useAsChatSkill) && <p>Mark a Note “Use as chat skill” or copy a starter below.</p>}
    <details><summary>Starter skills</summary>{starterChatSkills.map(starter => <article key={starter.id}><strong>{starter.title}</strong><p>{starter.description}</p><Button size="small" disabled={busy} onClick={() => { void run(async () => { await copyStarterChatSkill(chat.bookId, starter.id); setNotes(await listSkillNotes(chat.bookId)) }) }}>Copy {starter.title} to Notes</Button></article>)}</details>
    {error && <p role="alert">{error}</p>}
  </details>
}
