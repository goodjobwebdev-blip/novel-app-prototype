import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { getEntity, type BookEntity } from '../../data/persistence'
import { createLoreType, getEffectiveLoreTypes, loreTypeUsage, moveLoreType, renameLoreType, retireLoreType } from './lore-types-service'
import type { LoreType } from './lore-types'
import IllustrationModal from '../images/IllustrationModal'
import Button from '../../shared/ui/Button'
import Disclosure from '../../shared/ui/Disclosure'
import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'
import './codex-ui-kit.css'
export function useLoreTypes(ownerId?: string) {
  const [types, setTypes] = useState<LoreType[]>([]), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const reload = () => { if (ownerId) void getEffectiveLoreTypes(ownerId).then(value => { if (active) { setTypes(value); setError('') } }).catch(reason => { if (active) setError(reason.message) }); else setTypes([]) }
    reload(); window.addEventListener('arc-lore-types-changed', reload)
    return () => { active = false; window.removeEventListener('arc-lore-types-changed', reload) }
  }, [ownerId])
  return { types, error }
}
export function LoreTypeSelect({ ownerId, value, disabled, onChange, label = 'Lore type' }: { ownerId: string; value: string; disabled?: boolean; onChange: (id: string) => void; label?: string }) {
  const { types, error } = useLoreTypes(ownerId)
  const selected = types.find(type => type.id === value || type.name === value)?.id ?? value
  return <Select className="lore-type-select" label={label} error={error || undefined} disabled={disabled || !types.length} value={selected} onChange={event => onChange(event.target.value)}>{!types.some(type => type.id === selected) && <option value={selected} disabled>{value || 'Choose type'} · unavailable</option>}{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select>
}
export function LoreTypesManager({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<BookEntity>(), [scope, setScope] = useState<'book' | 'series'>('book'), [name, setName] = useState(''), [editing, setEditing] = useState<{ id: string; name: string }>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [retiring, setRetiring] = useState<{ type: LoreType; usage: Awaited<ReturnType<typeof loreTypeUsage>> }>(), [replacement, setReplacement] = useState('')
  useEffect(() => { let active = true; void getEntity<BookEntity>(bookId).then(value => { if (active) { setBook(value); setScope('book') } }); return () => { active = false } }, [bookId])
  const ownerId = scope === 'series' && book?.seriesId ? book.seriesId : bookId
  const { types, error: loadError } = useLoreTypes(ownerId)
  async function run(action: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await action() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  return <Disclosure className="lore-types-manager" title="Manage lore types"><Select label="Scope" disabled={busy} value={scope} onChange={event => { setScope(event.target.value as 'book' | 'series'); setEditing(undefined) }}><option value="book">This book</option>{book?.seriesId && <option value="series">Series · all member books</option>}</Select><p>Names are display labels. Renaming preserves entry and template type identities.</p>
    {types.map((type, index) => <article key={type.id}><span>{type.name}<small>{type.builtin ? ' · built-in' : type.ownerId !== ownerId ? ' · inherited' : ' · custom'}</small></span>{type.ownerId === ownerId && <div><Button className="codex-icon-action" size="small" variant="ghost" leadingIcon={<ArrowUp />} aria-label={`Move ${type.name} up`} disabled={busy || index === 0 || types[index - 1]?.ownerId !== ownerId} onClick={() => { void run(() => moveLoreType(ownerId, type.id, -1)) }} /><Button className="codex-icon-action" size="small" variant="ghost" leadingIcon={<ArrowDown />} aria-label={`Move ${type.name} down`} disabled={busy || index === types.length - 1} onClick={() => { void run(() => moveLoreType(ownerId, type.id, 1)) }} />{!type.builtin && <><Button size="small" variant="ghost" disabled={busy} onClick={() => setEditing({ id: type.id, name: type.name })}>Rename</Button><Button size="small" variant="danger" disabled={busy} onClick={() => { void run(async () => { setRetiring({ type, usage: await loreTypeUsage(ownerId, type.id) }); setReplacement('') }) }}>Retire…</Button></>}</div>}{editing?.id === type.id && <div className="codex-inline-field"><Input label="New type name" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /><Button size="small" disabled={busy || !editing.name.trim()} onClick={() => { void run(async () => { await renameLoreType(ownerId, type.id, editing.name); setEditing(undefined) }) }}>Save name</Button></div>}</article>)}
    <Input label="New custom type" value={name} onChange={event => setName(event.target.value)} maxLength={80} /><Button size="small" disabled={busy || !name.trim()} onClick={() => { void run(async () => { await createLoreType(ownerId, name); setName('') }) }}>Add lore type</Button>
    {retiring && <IllustrationModal title={`Retire ${retiring.type.name}`} onClose={() => setRetiring(undefined)} footer={<><Button variant="ghost" disabled={busy} onClick={() => setRetiring(undefined)}>Cancel</Button><Button variant="danger" disabled={busy || !replacement} onClick={() => { void run(async () => { await retireLoreType(ownerId, retiring.type.id, replacement, retiring.usage.token); setRetiring(undefined) }) }}>Reassign and retire</Button></>}><p><strong>{retiring.usage.scope}</strong><br />{retiring.usage.entries.length} entries and {retiring.usage.templates.length} templates will use the replacement. Their content is preserved.</p><Select label="Replacement type" aria-label="Replacement lore type" value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">Choose replacement…</option>{types.filter(type => type.id !== retiring.type.id).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select>{error && <p role="alert">{error}</p>}</IllustrationModal>}{(error || loadError) && <p role="alert">{error || loadError}</p>}
  </Disclosure>
}
