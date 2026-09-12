import type { NormalizedAssembledRequest } from './prompt-composition'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ExpandableTextInput from './ExpandableTextInput'
import { protectedRanges } from './document-projection.ts'

export type RewriteRequestPreview = { model: string; request: NormalizedAssembledRequest }

export default function ProseRewriteDialog({ title, original, instruction: initialInstruction, instructionReadOnly = false, autoStart = false, generate, apply, close }: {
  title: string; original: string; instruction: string; instructionReadOnly?: boolean; autoStart?: boolean
  generate: (instruction: string, chunk: (text: string) => void, signal: AbortSignal, onRequest?: (value: RewriteRequestPreview) => void) => Promise<void>
  apply: (text: string) => boolean; close: () => void
}) {
  const [instruction, setInstruction] = useState(initialInstruction)
  const [result, setResult] = useState('')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')
  const [request, setRequest] = useState<RewriteRequestPreview | null>(null)
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLElement>(null)
  async function run() {
    if (controller.current) return
    const owned = new AbortController(); controller.current = owned
    setResult(''); setError(''); setRequest(null); setRunning(true); setStatus('Generating preview…')
    try {
      await generate(instruction, (text) => { if (controller.current === owned && !owned.signal.aborted) setResult((value) => value + text) }, owned.signal, (value) => { if (controller.current === owned && !owned.signal.aborted) setRequest(value) })
      if (controller.current === owned) setStatus(owned.signal.aborted ? 'Stopped' : 'Preview ready')
    } catch (e) { if (controller.current === owned) { setStatus(owned.signal.aborted ? 'Stopped' : 'Failed'); if (!owned.signal.aborted) setError(e instanceof Error ? e.message : 'Generation failed.') } }
    finally { if (controller.current === owned) { controller.current = null; setRunning(false) } }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('textarea, button')?.focus()
    if (autoStart) void run()
    return () => { controller.current?.abort(); controller.current = null; if (previous?.isConnected) previous.focus() }
  }, [])
  const stop = () => { controller.current?.abort(); setStatus('Stopping…') }
  return createPortal(<div className="editor-block-backdrop"><section className="editor-block-dialog prose-rewrite-dialog" role="dialog" aria-modal="true" aria-labelledby="prose-rewrite-title" ref={dialog} onKeyDown={(event) => {
    if (event.key === 'Escape') { controller.current?.abort(); close() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled)') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <header><h2 id="prose-rewrite-title">{title}</h2><button type="button" onClick={() => { controller.current?.abort(); close() }} aria-label="Close rewrite preview">×</button></header>
    <p>Review the replacement before applying it to this passage.</p>
    <label>Instruction<ExpandableTextInput value={instruction} onChange={setInstruction} readOnly={instructionReadOnly || running} aria-label="Rewrite instruction" dialogTitle="Rewrite instruction" /></label>
    <details open><summary>Original passage</summary><pre className="rewrite-original">{original || 'No prose generated yet.'}</pre></details>
    <label>Replacement<ExpandableTextInput value={result} onChange={setResult} readOnly={running} aria-label="Replacement preview" dialogTitle="Edit replacement preview" /></label>
    {request && <details><summary>Request preview · {request.model}</summary><pre className="rewrite-original">{JSON.stringify({ model: request.model, messages: request.request.providerMessages }, null, 2)}</pre></details>}
    <p role="status">{status}</p>{error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={() => { controller.current?.abort(); close() }}>Discard</button>{running ? <button type="button" onClick={stop}>Stop</button> : <button type="button" disabled={!instruction.trim()} onClick={() => { void run() }}>{result ? 'Regenerate preview' : 'Generate preview'}</button>}<button type="button" disabled={running || !result.trim() || Boolean(protectedRanges(result).length)} onClick={() => { if (apply(result)) close(); else setError('The document or passage changed. Close this preview and select it again.') }}>Apply replacement</button></footer>
  </section></div>, document.body)
}
