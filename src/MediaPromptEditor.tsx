import { useEffect, useRef, useState } from 'react'
import ExpandableTextInput from './ExpandableTextInput'
import type { MediaGenerationDraft } from './image-generation-types'
import type { RewriteRequestPreview } from './ProseRewriteDialog'
import { defaultMediaEnhancementPrompt, enhanceMediaPrompt, mediaEnhancementFingerprint, mediaEnhancementIsStale, mediaGuidanceChips, selectedMediaPrompt } from './media-prompt'

export default function MediaPromptEditor({ value, onChange, capability, bookId }: { value: MediaGenerationDraft; onChange: (value: MediaGenerationDraft) => void; capability: string; bookId?: string }) {
  const [guidanceOpen, setGuidanceOpen] = useState(Boolean(value.enhancementGuidance))
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const [request, setRequest] = useState<RewriteRequestPreview>()
  const owner = useRef<AbortController | null>(null)
  const current = useRef({ value, onChange, capability }); current.current = { value, onChange, capability }
  useEffect(() => () => { owner.current?.abort(); owner.current = null }, [bookId])
  const change = (patch: Partial<MediaGenerationDraft>) => onChange({ ...value, ...patch })
  async function enhance(guided: boolean) {
    if (owner.current) return
    const controller = new AbortController(); owner.current = controller
    const snapshot = { ...value, enhancementMode: guided ? 'guided' as const : 'standard' as const }
    onChange(snapshot)
    const fingerprint = mediaEnhancementFingerprint(snapshot, capability)
    setBusy(true); setStatus('Enhancing…')
    try {
      const output = await enhanceMediaPrompt(snapshot, capability, bookId, controller.signal, setRequest)
      if (owner.current !== controller) return
      if (mediaEnhancementFingerprint(current.current.value, current.current.capability) !== fingerprint || current.current.value.enhancedPrompt !== snapshot.enhancedPrompt) {
        setStatus('The draft changed while enhancing. Your edits were kept; enhance again when ready.')
        return
      }
      current.current.onChange({ ...current.current.value, enhancedPrompt: output, enhancementFingerprint: fingerprint, promptSelection: 'enhanced' })
      setStatus('Enhanced draft ready')
    } catch (reason) {
      if (owner.current === controller) setStatus(controller.signal.aborted ? 'Stopped. Previous text kept.' : reason instanceof Error ? reason.message : 'Enhancement failed. Previous text kept.')
    } finally { if (owner.current === controller) { owner.current = null; setBusy(false) } }
  }
  return <section className="media-prompt-editor">
    <label><span>Original prompt</span><ExpandableTextInput rows={5} maxLength={32000} value={value.prompt} onChange={prompt => change({ prompt })} aria-label="Original media prompt" dialogTitle="Original media prompt" placeholder="Describe your image or video…" /></label>
    <div className="image-actions"><button type="button" disabled={busy || !value.prompt.trim()} onClick={() => { void enhance(false) }}>Enhance</button><button type="button" disabled={busy} onClick={() => setGuidanceOpen(open => !open)}>Enhance with guidance</button>{busy && <button type="button" onClick={() => owner.current?.abort()}>Stop enhancement</button>}</div>
    {guidanceOpen && <div><label><span>Enhancement guidance</span><ExpandableTextInput aria-label="Enhancement guidance" dialogTitle="Enhancement guidance" value={value.enhancementGuidance ?? ''} onChange={enhancementGuidance => change({ enhancementGuidance })} /></label><div className="image-actions">{mediaGuidanceChips.map(chip => <button key={chip} type="button" onClick={() => change({ enhancementGuidance: [value.enhancementGuidance, chip].filter(Boolean).join('\n') })}>{chip}</button>)}</div><button type="button" disabled={busy || !value.prompt.trim()} onClick={() => { void enhance(true) }}>Enhance with this guidance</button></div>}
    {value.enhancedPrompt !== undefined && <><label><span>Enhanced prompt {mediaEnhancementIsStale(value, capability) && <small>· Out of date</small>}</span><ExpandableTextInput rows={5} maxLength={32000} aria-label="Enhanced media prompt" dialogTitle="Enhanced media prompt" value={value.enhancedPrompt} onChange={enhancedPrompt => change({ enhancedPrompt })} /></label><fieldset className="media-prompt-source"><legend>Generate from</legend><label><input type="radio" name={`media-prompt-source-${bookId ?? 'global'}`} checked={value.promptSelection !== 'enhanced'} onChange={() => change({ promptSelection: 'original' })} />Original</label><label><input type="radio" name={`media-prompt-source-${bookId ?? 'global'}`} checked={value.promptSelection === 'enhanced'} onChange={() => change({ promptSelection: 'enhanced' })} />Enhanced</label></fieldset></>}
    <p role="status">{status}</p>
    <details><summary>Enhancement instructions</summary><ExpandableTextInput aria-label="Enhancement instructions" dialogTitle="Enhancement instructions" value={value.enhancementTemplate ?? defaultMediaEnhancementPrompt} onChange={enhancementTemplate => change({ enhancementTemplate })} /></details>
    <details><summary>Final media prompt preview</summary><pre>{selectedMediaPrompt(value) || 'Enter a prompt.'}</pre></details>
    {request && <details><summary>Last enhancement request · {request.model}</summary><pre>{JSON.stringify(request.request.providerMessages, null, 2)}</pre></details>}
  </section>
}
