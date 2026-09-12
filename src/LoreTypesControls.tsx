import { useEffect, useState } from 'react'
import { getEntity, type BookEntity } from './persistence'
import { createLoreType, getEffectiveLoreTypes, loreTypeUsage, moveLoreType, renameLoreType, retireLoreType } from './lore-types-service'
import type { LoreType } from './lore-types'
import IllustrationModal from './IllustrationModal'
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
  return <><select className="lore-type-select" aria-label={label} disabled={disabled || !types.length} value={selected} onChange={event => onChange(event.target.value)}>{!types.some(type => type.id === selected) && <option value={selected} disabled>{value || 'Choose type'} · unavailable</option>}{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select>{error && <small role="alert">{error}</small>}</>
}
export function LoreTypesManager({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<BookEntity>(), [scope, setScope] = useState<'book' | 'series'>('book'), [name, setName] = useState(''), [editing, setEditing] = useState<{ id: string; name: string }>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [retiring, setRetiring] = useState<{ type: LoreType; usage: Awaited<ReturnType<typeof loreTypeUsage>> }>(), [replacement, setReplacement] = useState('')
  useEffect(() => { let active = true; void getEntity<BookEntity>(bookId).then(value => { if (active) { setBook(value); setScope('book') } }); return () => { active = false } }, [bookId])
  const ownerId = scope === 'series' && book?.seriesId ? book.seriesId : bookId
  const { types, error: loadError } = useLoreTypes(ownerId)
  async function run(action: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await action() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  return <details className="lore-types-manager"><summary>Manage lore types</summary><label>Scope<select disabled={busy} value={scope} onChange={event => { setScope(event.target.value as 'book' | 'series'); setEditing(undefined) }}><option value="book">This book</option>{book?.seriesId && <option value="series">Series · all member books</option>}</select></label><p>Names are display labels. Renaming preserves entry and template type identities.</p>
    {types.map((type, index) => <article key={type.id}><span>{type.name}<small>{type.builtin ? ' · built-in' : type.ownerId !== ownerId ? ' · inherited' : ' · custom'}</small></span>{type.ownerId === ownerId && <div><button type="button" aria-label={`Move ${type.name} up`} disabled={busy || index === 0 || types[index - 1]?.ownerId !== ownerId} onClick={() => { void run(() => moveLoreType(ownerId, type.id, -1)) }}>↑</button><button type="button" aria-label={`Move ${type.name} down`} disabled={busy || index === types.length - 1} onClick={() => { void run(() => moveLoreType(ownerId, type.id, 1)) }}>↓</button>{!type.builtin && <><button type="button" disabled={busy} onClick={() => setEditing({ id: type.id, name: type.name })}>Rename</button><button type="button" disabled={busy} onClick={() => { void run(async () => { setRetiring({ type, usage: await loreTypeUsage(ownerId, type.id) }); setReplacement('') }) }}>Retire…</button></>}</div>}{editing?.id === type.id && <label>New type name<input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /><button type="button" disabled={busy || !editing.name.trim()} onClick={() => { void run(async () => { await renameLoreType(ownerId, type.id, editing.name); setEditing(undefined) }) }}>Save name</button></label>}</article>)}
    <label>New custom type<input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><button type="button" disabled={busy || !name.trim()} onClick={() => { void run(async () => { await createLoreType(ownerId, name); setName('') }) }}>Add lore type</button>
    {retiring && <IllustrationModal title={`Retire ${retiring.type.name}`} onClose={() => setRetiring(undefined)} footer={<><button type="button" disabled={busy} onClick={() => setRetiring(undefined)}>Cancel</button><button type="button" disabled={busy || !replacement} onClick={() => { void run(async () => { await retireLoreType(ownerId, retiring.type.id, replacement, retiring.usage.token); setRetiring(undefined) }) }}>Reassign and retire</button></>}><p><strong>{retiring.usage.scope}</strong><br />{retiring.usage.entries.length} entries and {retiring.usage.templates.length} templates will use the replacement. Their content is preserved.</p><label>Replacement type<select aria-label="Replacement lore type" value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">Choose replacement…</option>{types.filter(type => type.id !== retiring.type.id).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>{error && <p role="alert">{error}</p>}</IllustrationModal>}{(error || loadError) && <p role="alert">{error || loadError}</p>}
  </details>
}
