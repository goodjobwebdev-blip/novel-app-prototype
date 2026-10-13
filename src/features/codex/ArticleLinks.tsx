import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { CodexEntryEntity } from '../../data/persistence'
import Button from '../../shared/ui/Button'
import Disclosure from '../../shared/ui/Disclosure'
import Select from '../../shared/ui/Select'
import { articleLink, articleLinkIds } from './codex-article-links'
import './article-links.css'

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
  return <Disclosure className="codex-article-links" title="Article links" aria-label="Article links and backlinks" bodyClassName="codex-article-links__body">
    <div className="codex-article-links__insert">
      <Select label="Link to article" aria-label="Link to article" value={target} disabled={disabled} onChange={event => setTarget(event.target.value)}><option value="">Choose article</option>{available.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
      <Button className="codex-article-links__add" variant="secondary" leadingIcon={<Plus />} aria-label="Insert article link" title="Insert article link" disabled={disabled || !available.some(item => item.id === target)} onClick={() => { const item = available.find(item => item.id === target); if (item) onInsert(articleLink(item.id, item.title)) }} />
    </div>
    <p className="codex-article-links__help">Links still work after you rename an article.</p>
    <div className="codex-article-links__groups">
      <section className="codex-article-links__group" aria-label="Linked articles">
        <h3>Linked articles</h3>
        {outgoing.length ? <ul className="codex-article-links__list">{outgoing.map(id => <li key={id}><Button variant="ghost" size="small" disabled={!byId.has(id)} onClick={() => onOpen(id)}>{byId.get(id)?.title ?? 'Unavailable article'}</Button></li>)}</ul> : <p className="codex-article-links__empty">No article links.</p>}
      </section>
      <section className="codex-article-links__group" aria-label="Article backlinks">
        <h3>Backlinks</h3>
        {backlinks.length ? <ul className="codex-article-links__list">{backlinks.map(item => <li key={item.id}><Button variant="ghost" size="small" onClick={() => onOpen(item.id)}>{item.title}</Button></li>)}</ul> : <p className="codex-article-links__empty">No backlinks.</p>}
      </section>
    </div>
  </Disclosure>
}
