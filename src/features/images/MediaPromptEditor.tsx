import { useEffect, useRef, useState } from 'react'
import ExpandableTextInput, { type ExpandableTextInputDictationTarget } from '../../shared/ui/ExpandableTextInput'
import Button from '../../shared/ui/Button'
import Disclosure from '../../shared/ui/Disclosure'
import { Sparkles, Square } from 'lucide-react'
import { loadAiSettings } from '../../shared/ai/ai-settings'
import { defaultBookProfileSelections, resolveProfileSettings } from '../settings/settings-profiles'
import { getBookAiSettings } from '../../data/persistence'
import { cancelSttSession, getSttState, normalizeTranscriptForInsertion, startSttSession, stopSttSession, subscribeSttState } from '../speech/stt-service'
import type { MediaGenerationDraft } from './image-generation-types'
import { enhanceMediaPrompt, mediaEnhancementFingerprint, normalizeMediaPromptDraft } from './media-prompt'

export default function MediaPromptEditor({ value, onChange, capability, bookId }: { value: MediaGenerationDraft; onChange: (value: MediaGenerationDraft) => void; capability: string; bookId?: string }) {
  const draft = normalizeMediaPromptDraft(value)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const owner = useRef<AbortController | null>(null)
  const expandedEditorOpen = useRef(false)
  const [sttState, setSttState] = useState(getSttState)
  const dictationTarget = useRef<ExpandableTextInputDictationTarget | null>(null)
  const ownsDictation = useRef(false)
  const current = useRef({ value, onChange, capability }); current.current = { value, onChange, capability }
  useEffect(() => () => { owner.current?.abort(); owner.current = null }, [bookId])
  useEffect(() => subscribeSttState(setSttState), [])
  useEffect(() => () => cancelPromptDictation(), [bookId])
  const change = (patch: Partial<MediaGenerationDraft>) => onChange({ ...draft, ...patch })

  function cancelPromptDictation() {
    if (ownsDictation.current) cancelSttSession()
    ownsDictation.current = false
    dictationTarget.current = null
  }

  async function dictatePrompt(target: ExpandableTextInputDictationTarget) {
    if (busy || !target.isValid()) return false
    dictationTarget.current = target
    // Clear the previous session's terminal status before asynchronously loading settings.
    setSttState({ status: 'idle', label: '', target: 'media-prompt', live: false })
    const valid = () => dictationTarget.current === target && target.isValid()
    const base = target.value
    const before = base.slice(0, target.selectionStart), after = base.slice(target.selectionEnd)
    const write = (text: string) => valid() && target.setValue(text)
    const render = (transcript: string) => {
      const insertion = normalizeTranscriptForInsertion(transcript, before, after)
      return { value: before + insertion + after, cursor: before.length + insertion.length }
    }
    try {
      const defaults = loadAiSettings()
      const settings = bookId ? await getBookAiSettings(bookId, defaults.favorites) : resolveProfileSettings(defaultBookProfileSelections())
      if (!valid()) return false
      if (!['idle', 'completed', 'cancelled', 'failed'].includes(getSttState().status)) throw new Error('Another dictation session is already active.')
      ownsDictation.current = true
      await startSttSession(settings.speech, {
        kind: 'media-prompt', presentation: 'expanded', label: 'Dictate media prompt',
        isValid: valid,
        onProvisional: transcript => {
          if (!write(render(transcript).value)) throw new Error('The media prompt is no longer available.')
        },
        onFinal: transcript => {
          const next = render(transcript)
          if (!write(next.value)) throw new Error('The media prompt is no longer available.')
          target.focus(next.cursor)
          ownsDictation.current = false
          dictationTarget.current = null
        },
        onCancel: () => {
          write(base)
          ownsDictation.current = false
          dictationTarget.current = null
        },
      })
      return true
    } catch (reason) {
      if (dictationTarget.current === target) {
        write(base)
        if (valid()) target.reportError(reason instanceof Error ? reason.message : 'Could not start media prompt dictation.')
        ownsDictation.current = false
        dictationTarget.current = null
      }
      return false
    }
  }
  async function enhance() {
    if (owner.current || !draft.prompt.trim()) return
    const controller = new AbortController(); owner.current = controller
    const snapshot = draft
    const fingerprint = mediaEnhancementFingerprint(snapshot, capability)
    setBusy(true); setStatus('Enhancing…')
    try {
      const output = await enhanceMediaPrompt(snapshot, capability, bookId, controller.signal)
      if (owner.current !== controller) return
      // Expanded editors hold unapplied local text that the fingerprint cannot see.
      if (expandedEditorOpen.current) {
        setStatus('An expanded editor is open. Your text was kept; apply or close it before enhancing again.')
        return
      }
      if (mediaEnhancementFingerprint(current.current.value, current.current.capability) !== fingerprint) {
        setStatus('The draft changed while enhancing. Your edits were kept; enhance again when ready.')
        return
      }
      current.current.onChange({ ...normalizeMediaPromptDraft(current.current.value), prompt: output })
      setStatus('Prompt enhanced')
    } catch (reason) {
      if (owner.current === controller) setStatus(controller.signal.aborted ? 'Stopped. Previous text kept.' : reason instanceof Error ? reason.message : 'Enhancement failed. Previous text kept.')
    } finally { if (owner.current === controller) { owner.current = null; setBusy(false) } }
  }
  return <section className="media-prompt-editor">
    <label className="media-prompt-field"><span>Prompt</span><ExpandableTextInput maxLength={32000} value={draft.prompt} onChange={prompt => change({ prompt })} aria-label="Media prompt" dialogTitle="Media prompt" onOpenChange={open => { expandedEditorOpen.current = open }} placeholder="Describe your image or video…" onDictate={dictatePrompt} dictationStatus={sttState.target === 'media-prompt' ? sttState.status : 'idle'} dictationError={sttState.target === 'media-prompt' ? sttState.error : undefined} dictationDisabled={busy} onStopDictation={() => { if (ownsDictation.current) stopSttSession() }} onCancelDictation={cancelPromptDictation} /></label>
    <Disclosure title="Enhancement">
      <div className="media-enhancement-controls">
        <label className="media-prompt-field"><span>Guidance (optional)</span><ExpandableTextInput maxLength={32000} aria-label="Enhancement guidance" dialogTitle="Enhancement guidance" onOpenChange={open => { expandedEditorOpen.current = open }} value={draft.enhancementGuidance ?? ''} onChange={enhancementGuidance => change({ enhancementGuidance })} placeholder="How should the prompt be improved?" /></label>
        <Button className="media-enhance-action" aria-label={busy ? 'Stop enhancement' : 'Enhance'} title={busy ? 'Stop enhancement' : 'Enhance prompt'} disabled={!busy && !draft.prompt.trim()} onClick={() => { if (busy) owner.current?.abort(); else void enhance() }}>{busy ? <Square size={18} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}</Button>
      </div>
    </Disclosure>
    {status && <p role="status">{status}</p>}
  </section>
}
