import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { generateSynonyms, synonymContext, type SynonymCandidate } from './synonyms'
import type { QuickToolCapture } from './quick-tools'
import { protectedRanges } from './document-projection.ts'
import type { RewriteRequestPreview } from './ProseRewriteDialog'

export default function SynonymsDialog({ capture, apply, close }: { capture: QuickToolCapture; apply: (text: string) => boolean; close: () => void }) {
  const context = synonymContext(capture)
  const [candidates, setCandidates] = useState<SynonymCandidate[]>([])
  const [replacement, setReplacement] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [request, setRequest] = useState<RewriteRequestPreview | null>(null)
  const controller = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLElement>(null)
  async function run() {
    if (controller.current) return
    const owned = new AbortController(); controller.current = owned
    setRunning(true); setError(''); setStatus('Requesting alternatives…')
    try {
      const next = await generateSynonyms(capture, candidates, owned.signal, (value) => { if (controller.current === owned) setRequest(value) })
      if (controller.current !== owned) return
      setCandidates(next); setStatus(next.length > candidates.length ? 'Choose a candidate to preview it.' : 'No new alternatives returned. Retry or adjust the selected phrase.')
    } catch (e) { if (controller.current === owned) { setStatus(owned.signal.aborted ? 'Stopped' : 'Could not get suggestions'); if (!owned.signal.aborted) setError(e instanceof Error ? e.message : 'Suggestion request failed.') } }
    finally { if (controller.current === owned) { controller.current = null; setRunning(false) } }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('button')?.focus(); void run()
    return () => { controller.current?.abort(); controller.current = null; if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="editor-block-backdrop"><section className="editor-block-dialog synonyms-dialog" role="dialog" aria-modal="true" aria-labelledby="synonyms-title" ref={dialog} onKeyDown={(event) => {
    if (event.key === 'Escape') { controller.current?.abort(); close() }
    if (event.key === 'Tab') { const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
  }}>
    <header><h2 id="synonyms-title">Synonyms for “{context.selected}”</h2><button type="button" aria-label="Close synonyms" onClick={() => { controller.current?.abort(); close() }}>×</button></header>
    <p>Each generation sends a new request to your Support model.</p>
    <div className="synonym-candidates" role="group" aria-label="Synonym candidates">{candidates.map((candidate) => <button key={candidate.text} type="button" disabled={running} aria-pressed={replacement === candidate.text} onClick={() => setReplacement(candidate.text)}><strong>{candidate.text}</strong>{candidate.note && <small>{candidate.note}</small>}</button>)}</div>
    <label>Replacement<input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Choose a candidate or adjust it here" /></label>
    <p className="synonym-sentence">{context.before}<mark>{replacement || context.selected}</mark>{context.after}</p>
    <p role="status">{status}</p>{error && <p role="alert">{error}</p>}
    {request && <details><summary>Request preview · {request.model}</summary><pre className="rewrite-original">{JSON.stringify({ model: request.model, messages: request.request.providerMessages }, null, 2)}</pre></details>}
    <footer><button type="button" onClick={() => { controller.current?.abort(); close() }}>Discard</button>{running ? <button type="button" onClick={() => { controller.current?.abort(); setStatus('Stopping…') }}>Stop</button> : <button type="button" onClick={() => { void run() }}>{candidates.length ? 'Generate more' : 'Retry'}</button>}<button type="button" disabled={running || !replacement.trim() || Boolean(protectedRanges(replacement).length)} onClick={() => { if (apply(replacement)) close(); else setError('The source changed. Close this dialog and select the word again.') }}>Apply replacement</button></footer>
  </section></div>, document.body)
}
