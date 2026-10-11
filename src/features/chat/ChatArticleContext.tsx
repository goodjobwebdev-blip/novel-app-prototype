import { useEffect, useRef, useState } from 'react'
import { isCodexEntryArchived, listEntitiesByBook, type CodexEntryEntity } from '../../data/persistence'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import { setChatArticleIncluded, type ChatEntity } from './chat-service'

export default function ChatArticleContext({ chat, currentArticleId, disabled, onChange }: {
  chat: ChatEntity; currentArticleId?: string | null; disabled: boolean; onChange: (chat: ChatEntity) => void
}) {
  const [entries, setEntries] = useState<CodexEntryEntity[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  useEffect(() => {
    let live = true, revision = 0
    setEntries([]); setError('')
    const load = () => {
      const request = ++revision
      void listEntitiesByBook(chat.bookId, 'codexEntry').then(items => {
        if (live && revision === request) { setEntries(items.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item))); setError('') }
      }).catch(reason => { if (live && revision === request) setError(reason instanceof Error ? reason.message : 'Articles could not be loaded. Try again.') })
    }
    load(); window.addEventListener('arc-worlds-changed', load); window.addEventListener('arc-entity-changed', load)
    return () => { live = false; window.removeEventListener('arc-worlds-changed', load); window.removeEventListener('arc-entity-changed', load) }
  }, [chat.bookId])
  const selected = new Set(chat.contextProfile.codexEntryIds)
  const currentArticle = entries.find(entry => entry.id === currentArticleId)
  const change = async (id: string, include: boolean) => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError('')
    try { onChange(await setChatArticleIncluded(chat.id, id, include)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Article selection could not be saved. Try again.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="chat-article-context" aria-label="Explicit article context">
    <strong>Article context · {entries.filter(entry => selected.has(entry.id)).length} selected</strong>
    <p>{entries.filter(entry => selected.has(entry.id)).map(entry => entry.title).join(', ') || 'No articles selected. You can chat without lore.'}</p>
    <p>Sources are saved for this Chat. Opening another article does not change this selection.</p>
    {currentArticle && <Button size="small" disabled={disabled || busy || selected.has(currentArticle.id)} onClick={() => { void change(currentArticle.id, true) }}>{selected.has(currentArticle.id) ? 'Current article included in context' : 'Add current article to context'}</Button>}
    <details><summary>Choose articles</summary>{entries.map(entry => <Checkbox key={entry.id} label={entry.title} checked={selected.has(entry.id)} disabled={disabled || busy} onChange={event => { void change(entry.id, event.target.checked) }} />)}{!entries.length && <p>No available articles in this workspace.</p>}</details>
    {[...selected].filter(id => !entries.some(entry => entry.id === id)).map(id => <p key={id}>Unavailable selected article · not included in requests. <Button size="small" disabled={disabled || busy} onClick={() => { void change(id, false) }}>Remove unavailable source</Button></p>)}
    {chat.worldId && <p>Only this World’s articles and selected World Notes are available. Linked Book manuscripts and private lore are not included. Scene-specific actions require a Book.</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
