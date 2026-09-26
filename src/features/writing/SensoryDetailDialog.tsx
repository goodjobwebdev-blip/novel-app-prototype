import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, X } from 'lucide-react'
import { sensoryPrompts } from './prose-transformations'
import { generateSensoryDetails, validSensoryReplacement, type SensoryVariant } from './sensory-details'
import type { QuickToolCapture } from './quick-tools'

export default function SensoryDetailDialog({ capture, apply, close }: { capture: QuickToolCapture; apply: (text: string) => boolean; close: () => void }) {
  const [variants, setVariants] = useState<SensoryVariant[]>([])
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Finding sensory ideas…')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const editInput = useRef<HTMLTextAreaElement>(null)
  const editTrigger = useRef<HTMLButtonElement | null>(null)

  async function run() {
    if (controller.current) return
    const owned = new AbortController(); controller.current = owned
    setRunning(true); setStatus('Finding sensory ideas…'); setError('')
    try {
      await generateSensoryDetails(capture, variants, owned.signal, variant => {
        if (controller.current === owned && !owned.signal.aborted) setVariants(current => [...current, variant])
      })
      if (controller.current === owned) setStatus('Ideas ready.')
    } catch (reason) {
      if (controller.current === owned) {
        setStatus(owned.signal.aborted ? 'Stopped. Any ideas already shown are ready to use.' : 'Could not finish the suggestions.')
        if (!owned.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not get sensory ideas.')
      }
    } finally { if (controller.current === owned) { controller.current = null; setRunning(false) } }
  }
  const dismiss = () => { controller.current?.abort(); controller.current = null; close() }
  const stop = () => { controller.current?.abort(); controller.current = null; setRunning(false); setStatus('Stopped. Any ideas already shown are ready to use.') }
  const choose = (text: string) => {
    if (!validSensoryReplacement(text)) { setError('Use nonempty prose without image, comment or beat blocks.'); return }
    if (apply(text)) dismiss()
    else setError('The selected passage changed. Close this window and select it again.')
  }
  const finishEdit = () => { setEditing(null); editTrigger.current?.focus() }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('button')?.focus()
    void run()
    return () => { controller.current?.abort(); controller.current = null; if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => { if (editing) editInput.current?.focus() }, [editing?.id])

  return createPortal(<div className="editor-block-backdrop"><section className="editor-block-dialog sensory-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="sensory-detail-title" ref={dialog} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (editing) finishEdit(); else dismiss() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), summary') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header><h2 id="sensory-detail-title">Sensory detail</h2><button type="button" className="sensory-close" aria-label="Close sensory detail" onClick={dismiss}><X size={18} /></button></header>
    <p>Choose an idea to replace the selected passage. Use its pencil to review or edit the variant first.</p>
    <details className="sensory-original"><summary>Selected passage</summary><pre className="rewrite-original">{capture.snapshot.text}</pre></details>
    <div className="sensory-groups">{sensoryPrompts.map(sense => {
      const ideas = variants.filter(variant => variant.sense === sense.id)
      return <section className="sensory-group" key={sense.id} aria-labelledby={`sensory-${sense.id}`}>
        <h3 id={`sensory-${sense.id}`}>{sense.label}</h3>
        <div className="sensory-chips">{ideas.map(variant => <div className="sensory-chip" key={variant.id}>
          <button type="button" className="sensory-chip-use" title={editing?.id === variant.id ? editing.text : variant.text} onClick={() => choose(editing?.id === variant.id ? editing.text : variant.text)}>{variant.label}{variant.edited && <small>Edited</small>}</button>
          <button type="button" className="sensory-chip-edit" aria-label={`Edit ${variant.label}`} aria-expanded={editing?.id === variant.id} onClick={event => { editTrigger.current = event.currentTarget; setEditing({ id: variant.id, text: variant.text }); setError('') }}><Pencil size={15} /></button>
        </div>)}</div>
        {!ideas.length && <p className="sensory-empty">{running ? 'Finding ideas…' : 'No ideas for this sense yet.'}</p>}
        {editing && ideas.some(variant => variant.id === editing.id) && <div className="sensory-edit-panel">
          <label htmlFor="sensory-variant-text">Edit variant</label><textarea id="sensory-variant-text" ref={editInput} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} rows={6} />
          <div className="sensory-edit-actions"><button type="button" disabled={!validSensoryReplacement(editing.text)} onClick={() => choose(editing.text)}>Use this variant</button><button type="button" disabled={!validSensoryReplacement(editing.text)} onClick={() => { setVariants(current => current.map(variant => variant.id === editing.id ? { ...variant, text: editing.text, edited: true } : variant)); finishEdit() }}>Save edit</button><button type="button" onClick={finishEdit}>Cancel edit</button></div>
        </div>}
      </section>
    })}</div>
    <p className="sensory-status" role="status">{status}{variants.length > 0 && ` ${variants.length} ideas available.`}</p>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={dismiss}>Cancel</button>{running ? <button type="button" onClick={stop}>Stop</button> : <button type="button" onClick={() => { void run() }}>{variants.length ? 'More ideas' : 'Try again'}</button>}</footer>
  </section></div>, document.body)
}
