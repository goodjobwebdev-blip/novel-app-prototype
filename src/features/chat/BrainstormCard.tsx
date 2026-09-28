import { useEffect, useRef, useState } from 'react'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import ExpandableTextInput from '../../shared/ui/ExpandableTextInput'
import Input from '../../shared/ui/Input'
import { brainstormMoreText, brainstormSelectionText, type ChatBrainstorm } from './chat-brainstorm'
import { markChatBrainstormSubmitted, saveChatBrainstormDraft, type ChatMessageEntity } from './chat-service'

export default function BrainstormCard({ message, brainstorm, disabled, onSaved, onSend }: { message: ChatMessageEntity; brainstorm: ChatBrainstorm; disabled: boolean; onSaved: () => Promise<unknown>; onSend: (text: string) => Promise<boolean> }) {
  const [value, setValue] = useState(brainstorm)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [lastSent, setLastSent] = useState(brainstorm.submittedText ?? '')
  const busyRef = useRef(false)
  useEffect(() => setValue(brainstorm), [brainstorm])
  const dirty = JSON.stringify(value) !== JSON.stringify(brainstorm)
  async function act(next: ChatBrainstorm, followUp?: 'selection' | 'more') {
    if (busyRef.current || disabled) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const saved = await saveChatBrainstormDraft(message.bookId, message.parentId, message.id, next)
      setValue(saved); await onSaved()
      if (followUp) {
        const text = followUp === 'selection' ? brainstormSelectionText(saved) : brainstormMoreText(saved)
        if (text && await onSend(text)) {
          setLastSent(text)
          if (followUp === 'selection') await markChatBrainstormSubmitted(message.bookId, message.parentId, message.id, value.id, text)
        }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save these options.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const selection = brainstormSelectionText(value)
  return <section className="chat-brainstorm" aria-label={`Brainstorm: ${value.topic}`}>
    <header><small>Brainstorm</small><h3>{value.topic}</h3></header>
    <div className="chat-brainstorm-options">{value.options.map(option => <article className={value.selectedIds.includes(option.id) ? 'selected' : ''} key={option.id}>
      <Checkbox className="chat-brainstorm-choice" label={option.title} disabled={busy || disabled} checked={value.selectedIds.includes(option.id)} onChange={event => { const next = { ...value, selectedIds: event.target.checked ? [...value.selectedIds, option.id] : value.selectedIds.filter(id => id !== option.id) }; setValue(next); void act(next) }} />
      <p>{option.description}</p>{option.tradeOff && <small>Trade-off: {option.tradeOff}</small>}
      <details><summary>Edit option</summary><Input label="Title" aria-label={`Option title: ${option.title}`} disabled={busy || disabled} value={option.title} onChange={event => setValue(current => ({ ...current, options: current.options.map(item => item.id === option.id ? { ...item, title: event.target.value } : item) }))} /><ExpandableTextInput aria-label={`Option description: ${option.title}`} dialogTitle="Edit brainstorm option" readOnly={busy || disabled} value={option.description} onChange={description => setValue(current => ({ ...current, options: current.options.map(item => item.id === option.id ? { ...item, description } : item) }))} /><Input label="Trade-off" disabled={busy || disabled} value={option.tradeOff ?? ''} onChange={event => setValue(current => ({ ...current, options: current.options.map(item => item.id === option.id ? { ...item, tradeOff: event.target.value } : item) }))} /></details>
    </article>)}</div>
    <label><span>Your own option</span><ExpandableTextInput aria-label="Your own brainstorm option" dialogTitle="Your own brainstorm option" maxLength={4000} readOnly={busy || disabled} value={value.customOption} onChange={customOption => setValue(current => ({ ...current, customOption }))} /></label>
    <footer><Button size="small" variant="ghost" disabled={busy || disabled || !dirty} onClick={() => { void act(value) }}>Save option edits</Button><Button size="small" disabled={busy || disabled || !selection || selection === lastSent} onClick={() => { void act(value, 'selection') }}>Send selection</Button><Button size="small" variant="primary" disabled={busy || disabled} onClick={() => { void act(value, 'more') }}>Generate more</Button></footer>
    <p className="image-help">Selecting and saving options stays in this chat. Send selection or Generate more starts a new response.</p>
    {error && <p role="alert">{error}</p>}
  </section>
}
