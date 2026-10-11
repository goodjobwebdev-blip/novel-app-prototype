import { useEffect, useRef, useState } from 'react'
import { database, getEntity, isCodexEntryArchived, listEntitiesByBook, updateEntityAtomically, type CodexEntryEntity } from '../../data/persistence'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'
import { useLoreTypes } from '../codex/LoreTypesControls'
import { executeChatWorkspaceTool } from './chat-tools'
import type { ChatEntity, ChatMessageEntity } from './chat-service'
import { answerProse } from './chat-answer-groups'

export default function ArticleAnswerActions({ chat, message, sourceMessages = [message], content, disabled, onSaved, onBeforeArticleAction }: {
  chat: ChatEntity; message: ChatMessageEntity; sourceMessages?: ChatMessageEntity[]; content: string; disabled: boolean; onSaved: () => Promise<unknown>; onBeforeArticleAction?: () => Promise<boolean | void>
}) {
  const [mode, setMode] = useState<'create' | 'append' | 'replace'>()
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState('lore-other')
  const [entries, setEntries] = useState<CodexEntryEntity[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const sourceKey = JSON.stringify([chat.bookId, chat.id, message.id, content, sourceMessages.map(source => [source.id, source.content])])
  const currentAction = useRef({ sourceKey, disabled })
  currentAction.current = { sourceKey, disabled }
  const { types, error: typeError } = useLoreTypes(chat.bookId)
  useEffect(() => {
    if (!mode) return
    let live = true
    void listEntitiesByBook(chat.bookId, 'codexEntry').then(items => { if (live) setEntries(items.filter((item): item is CodexEntryEntity => item.type === 'codexEntry' && !isCodexEntryArchived(item))) }).catch(reason => { if (live) setError(reason.message) })
    return () => { live = false }
  }, [chat.bookId, mode])
  const propose = async () => {
    if (disabled || lock.current || !mode) return
    lock.current = true; setBusy(true); setError('')
    const isCurrent = () => mounted.current && !currentAction.current.disabled && currentAction.current.sourceKey === sourceKey
    try {
      if (await onBeforeArticleAction?.() === false) throw new Error('The current document could not be saved. Retry saving before preparing the article preview.')
      if (!isCurrent()) return
      const entity = mode !== 'create' ? await getEntity<CodexEntryEntity>(target) : undefined
      if (mode !== 'create' && (!entity || entity.type !== 'codexEntry' || isCodexEntryArchived(entity) || !entries.some(item => item.id === entity.id))) throw new Error('Choose an available article in this workspace.')
      const args = mode === 'create' ? { title, category: typeId, content } : { entity_id: entity!.id, expected_updated_at: entity!.updatedAt, new_content: mode === 'append' ? `${entity!.content}${entity!.content.trim() ? '\n\n' : ''}${content}` : content, summary: mode === 'append' ? 'Append this Chat answer to the article' : 'Replace article body with this Chat answer' }
      const result = await executeChatWorkspaceTool(chat.bookId, { id: `article-answer-${crypto.randomUUID()}`, type: 'function', function: { name: mode === 'create' ? 'propose_codex_entry' : 'propose_document_replacement', arguments: JSON.stringify(args) } })
      if (!result.proposal && !result.codexCreation) { const response = JSON.parse(result.content); throw new Error(response.error || 'The proposal could not be prepared.') }
      if (!isCurrent()) return
      const db = await database()
      await db.transaction('rw', db.table('entities'), async () => {
        const owner = await db.table('entities').get(chat.id) as ChatEntity | undefined
        const sources = await db.table('entities').bulkGet(sourceMessages.map(source => source.id)) as Array<ChatMessageEntity | undefined>
        if (!owner || owner.type !== 'chat' || owner.bookId !== chat.bookId || owner.character || !sources.length || !sources.some(source => source?.id === message.id)
          || sources.some((source, index) => !source || source.type !== 'chatMessage' || source.role !== 'assistant' || source.bookId !== chat.bookId || source.parentId !== chat.id || source.content !== sourceMessages[index].content)
          || answerProse(sources as ChatMessageEntity[]) !== content) throw new Error('The source answer changed or is no longer available. Review the latest answer before trying again.')
        await updateEntityAtomically<ChatMessageEntity>(message.id, current => {
          if (!isCurrent()) throw new Error('The source answer changed. Review the current Chat before trying again.')
          return { ...current, ...(result.proposal ? { documentEdits: [...(current.documentEdits ?? []), result.proposal] } : {}), ...(result.codexCreation ? { codexCreations: [...(current.codexCreations ?? []), result.codexCreation] } : {}), updatedAt: Math.max(Date.now(), current.updatedAt + 1) }
        })
      })
      // Once durable, close the form even if refreshing the conversation fails:
      // retrying a failed refresh must not silently duplicate a saved proposal.
      if (!isCurrent()) return
      setMode(undefined)
      try { await onSaved() }
      catch { if (isCurrent()) setError('The review proposal was saved, but Chat could not refresh. Reopen this Chat to review it; do not save the same proposal again.') }
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : 'Could not prepare the article preview.') }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="chat-article-actions" aria-label="Chat answer article actions">
    <Button size="small" disabled={disabled || busy || !content.trim()} onClick={() => { setMode('create'); setError('') }}>Create article…</Button>
    <Button size="small" disabled={disabled || busy || !content.trim()} onClick={() => { setMode('append'); setError('') }}>Append to article…</Button>
    <Button size="small" disabled={disabled || busy || !content.trim()} onClick={() => { setMode('replace'); setError('') }}>Replace article…</Button>
    {!mode && error && <p role="alert">{error}</p>}
    {mode && <section aria-label="Article action preview">
      <strong>{mode === 'create' ? 'Create article preview' : mode === 'append' ? 'Append preview' : 'Replace preview'}</strong>
      {mode === 'create' && typeError && <p role="alert">{typeError}</p>}
      {mode === 'create' ? <><Input label="New article title" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /><Select label="Article type" value={typeId} disabled={busy} onChange={event => setTypeId(event.target.value)}>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></> : <Select label="Target article" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="">Choose article explicitly</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</Select>}
      <p>No article changes until you review and approve the saved proposal below.{mode === 'replace' && ' Replacing removes the current article body.'}</p>
      {mode !== 'create' && target && <details><summary>Current article</summary><pre>{entries.find(entry => entry.id === target)?.content}</pre></details>}
      <details open><summary>Chat content to {mode}</summary><pre>{content}</pre></details>
      {error && <p role="alert">{error}</p>}
      <Button disabled={disabled || busy || (mode === 'create' ? !title.trim() || !types.some(type => type.id === typeId) : !entries.some(entry => entry.id === target))} onClick={() => { void propose() }}>Save review proposal</Button>
      <Button disabled={busy} onClick={() => setMode(undefined)}>Cancel</Button>
    </section>}
  </section>
}
