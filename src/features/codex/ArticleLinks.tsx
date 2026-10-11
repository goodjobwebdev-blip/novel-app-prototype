import { useState } from 'react'
import type { CodexEntryEntity } from '../../data/persistence'
import Button from '../../shared/ui/Button'
import { articleLink, articleLinkIds } from './codex-article-links'

export default function ArticleLinks({ entry, content, entries, onInsert, onOpen, disabled }: {
  entry: CodexEntryEntity; content: string; entries: CodexEntryEntity[]; onInsert: (markdown: string) => void; onOpen: (id: string) => void; disabled: boolean
}) {
  const [target, setTarget] = useState('')
  // A canonical World article must never expose a private Book article, even when
  // this panel is mounted with the Book's combined Codex list.
  const visible = entries.filter(item => !entry.worldId || (item.worldId === entry.worldId && item.bookId === entry.worldId))
  const available = visible.filter(item => item.id !== entry.id)
  const byId = new Map(visible.map(item => [item.id, item]))
  const outgoing = articleLinkIds(content)
  const backlinks = available.filter(item => articleLinkIds(item.content).includes(entry.id))
  return <section className="codex-article-links" aria-label="Article links and backlinks">
    <label>Link to article<select aria-label="Link to article" value={target} disabled={disabled} onChange={event => setTarget(event.target.value)}><option value="">Choose article</option>{available.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <Button disabled={disabled || !available.some(item => item.id === target)} onClick={() => { const item = available.find(item => item.id === target); if (item) onInsert(articleLink(item.id, item.title)) }}>Insert article link</Button>
    <p>Links use permanent article IDs and survive renaming.</p>
    <div aria-label="Linked articles"><strong>Links</strong>{outgoing.length ? outgoing.map(id => <Button key={id} disabled={!byId.has(id)} onClick={() => onOpen(id)}>{byId.get(id)?.title ?? 'Unavailable article'}</Button>) : <p>No article links.</p>}</div>
    <div aria-label="Article backlinks"><strong>Backlinks</strong>{backlinks.length ? backlinks.map(item => <Button key={item.id} onClick={() => onOpen(item.id)}>{item.title}</Button>) : <p>No backlinks.</p>}</div>
  </section>
}
