import { useEffect, useRef, useState } from 'react'
import { createCharacterChat, listCharacterCandidates, moveCharacterChat, type CharacterParticipant } from './character-chat'
import { readTimelineWorld } from '../codex/codex-timeline-service'
import { timelineScenes, type TimelineWorld } from '../codex/codex-timeline'
import type { BookEntity, CodexEntryEntity } from '../../data/persistence'
import { database, isCodexEntryArchived } from '../../data/persistence'
import { entityAvailableInBook } from '../worlds/world-service'
import { updateChat, type ChatEntity } from './chat-service'
import { IMAGE_STORE_CHANGED, listGalleryImages } from '../images/image-store'
import type { GalleryImage } from '../images/image-generation-types'
import IllustrationModal from '../images/IllustrationModal'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import Disclosure from '../../shared/ui/Disclosure'
import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'

export function CharacterChatSetup({ bookId, initialEntryId, currentSceneId, caret, chat, onClose, onOpen }: { bookId: string; initialEntryId?: string; currentSceneId?: string; caret?: number; chat?: ChatEntity; onClose: () => void; onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<CodexEntryEntity[]>([]), [world, setWorld] = useState<TimelineWorld>(), [participants, setParticipants] = useState<Array<Pick<CharacterParticipant, 'entryId' | 'label'>>>(chat?.character?.participants ?? []), [sceneId, setSceneId] = useState(chat?.character?.cutoff.sceneId ?? currentSceneId ?? ''), [position, setPosition] = useState<'start' | 'end' | 'caret' | 'saved'>(chat ? 'saved' : caret !== undefined ? 'caret' : 'end'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; void Promise.all([listCharacterCandidates(bookId), readTimelineWorld(bookId)]).then(([entries, world]) => { if (!live) return; setEntries(entries); setWorld(world); if (!chat && initialEntryId) { const entry = entries.find(e => e.id === initialEntryId); if (entry) setParticipants([{ entryId: entry.id, label: entry.title }]) } }).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [bookId, initialEntryId, chat?.id])
  const scene = world && timelineScenes(world, bookId).find(scene => scene.id === sceneId)
  const start = async (restart = false) => { if (busy || !scene) return; setBusy(true); setError(''); try { const cutoff = { bookId, sceneId, position: position === 'start' ? 0 : position === 'caret' ? caret! : position === 'saved' ? chat!.character!.cutoff.position! : String(scene.content ?? '').length }; const next = chat ? await moveCharacterChat(chat.id, cutoff, restart) : await createCharacterChat(bookId, participants, cutoff); onOpen(next.id); onClose() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <IllustrationModal title={chat ? 'Character story position' : 'New character chat'} onClose={() => { if (!busy) onClose() }} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>{chat && <Button variant="danger" disabled={busy || !scene} onClick={() => { void start(true) }}>Restart here without history</Button>}<Button variant="primary" loading={busy} disabled={!scene || !participants.length} onClick={() => { void start() }}>{chat ? 'Use this position' : 'Start character chat'}</Button></>}>
    <div className="character-chat-setup"><p>Each participant’s full Codex profile is included automatically, together with manuscript up to the selected story position. In Chat context settings, you can add Codex entries, notes, manuscript sections and summaries as references for this conversation.</p>
    {!chat && <fieldset disabled={busy}><legend>Participants</legend>{entries.map(entry => { const selected = participants.find(item => item.entryId === entry.id); return <div key={entry.id}><Checkbox label={`${entry.title} · ${entry.category}`} checked={Boolean(selected)} onChange={e => setParticipants(value => e.target.checked ? [...value, { entryId: entry.id, label: entry.title }] : value.filter(p => p.entryId !== entry.id))} />{selected && <Input label="Display label" value={selected.label} onChange={e => setParticipants(value => value.map(p => p.entryId === entry.id ? { ...p, label: e.target.value } : p))} />}</div> })}{!entries.length && <p>Create a Character entry or mark another Codex entry as a roleplay participant.</p>}</fieldset>}
    <Select label="Current scene" aria-label="Character chat scene" value={sceneId} disabled={busy} onChange={e => { setSceneId(e.target.value); setPosition('end') }}><option value="">Choose a scene</option>{world && timelineScenes(world, bookId).map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</Select><Select label="Cutoff" aria-label="Character chat cutoff" value={position} disabled={busy} onChange={e => setPosition(e.target.value as typeof position)}><option value="start">Start of scene</option><option value="end">End of scene</option>{caret !== undefined && currentSceneId === sceneId && <option value="caret">Captured editor caret</option>}{chat && sceneId === chat.character?.cutoff.sceneId && <option value="saved">Saved position</option>}</Select>
    {chat && <p>Moving earlier creates a new chat with empty history. Moving forward changes subsequent requests. Restart also starts fresh at the chosen position.</p>}{error && <p role="alert">{error}</p>}</div>
  </IllustrationModal>
}
export function CharacterPosition({ chat, disabled, onOpen }: { chat: ChatEntity; disabled: boolean; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return chat.character ? <div className="character-position"><p>Character chat · {chat.character.participants.map(p => p.label).join(', ')}</p><Button size="small" disabled={disabled} onClick={() => setOpen(true)}>Story position / restart</Button>{open && <CharacterChatSetup bookId={chat.bookId} chat={chat} onClose={() => setOpen(false)} onOpen={onOpen} />}</div> : null
}
export function RoleplayParticipant({ bookId, entry, disabled, onBeforeChange, onRefresh, onStart }: { bookId?: string; entry: CodexEntryEntity; disabled?: boolean; onBeforeChange: () => Promise<void>; onRefresh: () => Promise<void>; onStart: () => void }) {
  const [error, setError] = useState('')
  const eligible = entry.typeId === 'lore-character' || entry.roleplayParticipant === true
  const setParticipant = async (enabled: boolean) => {
    const db = await database()
    await db.transaction('rw', db.table('entities'), async () => {
      const current = await db.table('entities').get(entry.id) as CodexEntryEntity | undefined
      const book = bookId !== undefined ? await db.table('entities').get(bookId) as BookEntity | undefined : undefined
      if (current?.type !== 'codexEntry' || current.bookId !== entry.bookId || current.worldId !== entry.worldId || isCodexEntryArchived(current) || (bookId !== undefined && !entityAvailableInBook(current, book))) throw new Error('This entry changed or is no longer available.')
      await db.table('entities').put({ ...current, roleplayParticipant: enabled, updatedAt: Math.max(Date.now(), current.updatedAt + 1) })
    })
  }
  return <div className="roleplay-participant">{entry.typeId !== 'lore-character' && <Checkbox label="Use as roleplay participant" disabled={disabled || isCodexEntryArchived(entry)} checked={entry.roleplayParticipant === true} onChange={e => { const enabled = e.target.checked; void onBeforeChange().then(() => setParticipant(enabled)).then(onRefresh).catch(e => setError(e.message)) }} />}{eligible && <Button size="small" disabled={disabled || isCodexEntryArchived(entry)} onClick={onStart}>Chat with character</Button>}{error && <p role="alert">{error}</p>}</div>
}
export function ChatImageReferences({ chat, disabled, onChange }: { chat: ChatEntity; disabled?: boolean; onChange: (chat: ChatEntity) => void }) {
  const busy = useRef(false)
  async function save(ids: string[]) { if (busy.current || disabled) return; busy.current = true; try { onChange(await updateChat(chat.id, { directImageReferenceIds: [...new Set(ids)] })) } catch (error) { setError((error as Error).message) } finally { busy.current = false } }
  const [assets, setAssets] = useState<GalleryImage[]>([]), [error, setError] = useState('')
  useEffect(() => {
    let current = true, revision = 0
    const reload = () => {
      const request = ++revision
      void listGalleryImages(chat.bookId).then(assets => {
        if (current && request === revision) { setAssets(assets.filter(a => a.kind !== 'video')); setError('') }
      }).catch(e => { if (current && request === revision) setError(e.message) })
    }
    window.addEventListener(IMAGE_STORE_CHANGED, reload)
    reload()
    return () => { current = false; window.removeEventListener(IMAGE_STORE_CHANGED, reload) }
  }, [chat.bookId])
  return <Disclosure className="chat-image-references" title="Image references" description={`${chat.directImageReferenceIds?.length ?? 0} selected`}><p>Used only when you explicitly request an image. No reference image is selected automatically.</p>{assets.map(asset => <Checkbox key={asset.id} label={asset.prompt || 'Saved image'} disabled={disabled} checked={chat.directImageReferenceIds?.includes(asset.id) ?? false} onChange={e => { const ids = chat.directImageReferenceIds ?? [], next = e.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id); void save(next) }} />)}{(chat.directImageReferenceIds ?? []).filter(id => !assets.some(asset => asset.id === id)).map(id => <Button size="small" variant="ghost" disabled={disabled} key={id} onClick={() => { void save((chat.directImageReferenceIds ?? []).filter(value => value !== id)) }}>Remove unavailable reference</Button>)}{!assets.length && <p>No saved still images in this book.</p>}{error && <p role="alert">{error}</p>}</Disclosure>
}
