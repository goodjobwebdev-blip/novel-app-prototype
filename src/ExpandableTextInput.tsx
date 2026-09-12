import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ForwardedRef,
  type TextareaHTMLAttributes,
} from 'react'
import { Expand, Mic, Square, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { SttStatus } from './stt-service'

export type ExpandableTextInputDictationTarget = {
  element: HTMLTextAreaElement
  value: string
  selectionStart: number
  selectionEnd: number
  isValid: () => boolean
  setValue: (value: string) => boolean
  reportError: (message: string) => void
  focus: (cursor: number) => void
}

type ExpandableTextInputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  dialogTitle?: string
  onDictate?: (target: ExpandableTextInputDictationTarget) => Promise<boolean>
  dictationError?: string
  dictationStatus?: SttStatus
  dictationDisabled?: boolean
  onStopDictation?: () => void
  onCancelDictation?: () => void
}

function assignRef(ref: ForwardedRef<HTMLTextAreaElement>, value: HTMLTextAreaElement | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

const ExpandableTextInput = forwardRef<HTMLTextAreaElement, ExpandableTextInputProps>(function ExpandableTextInput({
  value,
  onChange,
  dialogTitle = 'Edit prompt',
  onDictate,
  dictationStatus = 'idle',
  dictationError,
  dictationDisabled = false,
  onStopDictation,
  onCancelDictation,
  'aria-label': ariaLabel = 'Generation prompt',
  ...textareaProps
}, forwardedRef) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [expandedDictation, setExpandedDictation] = useState(false)
  const [error, setError] = useState('')
  const attemptedDictationRef = useRef(false)
  const compactRef = useRef<HTMLTextAreaElement | null>(null)
  const expandedRef = useRef<HTMLTextAreaElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const cancelDictationRef = useRef<HTMLButtonElement | null>(null)
  const openRef = useRef(false)
  const expandedDictationRef = useRef(false)
  const onCancelDictationRef = useRef(onCancelDictation)
  onCancelDictationRef.current = onCancelDictation
  const titleId = useId()
  const dictationActive = expandedDictation && ['requesting-permission', 'recording', 'recording-live', 'stopping', 'transcribing', 'finalizing'].includes(dictationStatus)
  const recording = dictationStatus === 'recording' || dictationStatus === 'recording-live'

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      expandedRef.current?.focus()
      expandedRef.current?.setSelectionRange(draft.length, draft.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])') ?? [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => document.removeEventListener('keydown', handleDialogKeyDown)
  }, [open, dictationActive])

  useEffect(() => {
    if (expandedDictation && ['cancelled', 'failed', 'completed'].includes(dictationStatus)) setExpandedDictationOwned(false)
    if (openRef.current && attemptedDictationRef.current && dictationStatus === 'failed' && dictationError) setError(dictationError)
  }, [dictationStatus, dictationError, expandedDictation])

  useEffect(() => () => {
    if (expandedDictationRef.current) onCancelDictationRef.current?.()
  }, [])

  function setExpandedDictationOwned(active: boolean) {
    expandedDictationRef.current = active
    setExpandedDictation(active)
  }

  function returnFocus() {
    requestAnimationFrame(() => compactRef.current?.focus())
  }

  function openDialog() {
    setDraft(value)
    setError('')
    attemptedDictationRef.current = false
    openRef.current = true
    setOpen(true)
  }

  function closeDialog() {
    openRef.current = false
    if (expandedDictationRef.current) onCancelDictation?.()
    setExpandedDictationOwned(false)
    setOpen(false)
    returnFocus()
  }

  function applyDraft() {
    if (expandedDictationRef.current) return
    onChange(draft)
    openRef.current = false
    setOpen(false)
    returnFocus()
  }

  async function startExpandedDictation() {
    const element = expandedRef.current
    if (!element || !onDictate || dictationDisabled) return
    setError('')
    attemptedDictationRef.current = true
    const target: ExpandableTextInputDictationTarget = {
      element,
      value: draft,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      isValid: () => openRef.current && expandedRef.current === element,
      setValue: (nextValue) => {
        if (!openRef.current || expandedRef.current !== element) return false
        setDraft(nextValue)
        return true
      },
      reportError: (message) => { if (openRef.current) setError(message) },
      focus: (cursor) => {
        requestAnimationFrame(() => {
          if (!openRef.current || expandedRef.current !== element) return
          element.focus()
          element.setSelectionRange(cursor, cursor)
        })
      },
    }
    setExpandedDictationOwned(true)
    try {
      if (!await onDictate(target)) setExpandedDictationOwned(false)
    } catch (cause) {
      target.reportError(cause instanceof Error ? cause.message : 'Could not start dictation.')
      setExpandedDictationOwned(false)
    }
  }

  function stopExpandedDictation() {
    onStopDictation?.()
    requestAnimationFrame(() => cancelDictationRef.current?.focus())
  }

  function cancelExpandedDictation() {
    onCancelDictation?.()
    requestAnimationFrame(() => expandedRef.current?.focus())
  }

  function dictationLabel() {
    if (dictationStatus === 'recording' || dictationStatus === 'recording-live') return 'Listening…'
    if (dictationStatus === 'transcribing') return 'Transcribing…'
    if (dictationStatus === 'finalizing') return 'Finalizing…'
    if (dictationStatus === 'stopping') return 'Stopping…'
    return 'Connecting…'
  }

  return <>
    <div className="expandable-text-input">
      <textarea
        {...textareaProps}
        ref={(element) => {
          compactRef.current = element
          assignRef(forwardedRef, element)
        }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
      />
      <button className="expandable-text-trigger" type="button" onClick={openDialog} aria-label={`Expand ${ariaLabel}`} title={`Expand ${ariaLabel}`}>
        <Expand aria-hidden="true" />
      </button>
    </div>
    {open && createPortal(
      <div
        className="expandable-text-backdrop"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        <section ref={dialogRef} className="expandable-text-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <header>
            <h2 id={titleId}>{dialogTitle}</h2>
            <button type="button" onClick={closeDialog} aria-label="Close expanded editor" title="Close expanded editor">
              <X aria-hidden="true" />
            </button>
          </header>
          <textarea ref={expandedRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Expanded ${ariaLabel}`} readOnly={textareaProps.readOnly || expandedDictation} disabled={textareaProps.disabled} spellCheck={textareaProps.spellCheck} />
          {error && <p className="expandable-dictation-error" role="alert">{error}</p>}
          <footer>
            {onDictate && (expandedDictation ? <div className="expandable-dictation-status" role="status" aria-live="polite">
              <span><Mic aria-hidden="true" />{dictationLabel()}</span>
              {recording && <button className="expandable-dictation-stop" type="button" onClick={stopExpandedDictation} aria-label="Stop dictation"><Square aria-hidden="true" fill="currentColor" /></button>}
              {dictationActive && <button ref={cancelDictationRef} className="expandable-dictation-cancel" type="button" onClick={cancelExpandedDictation} aria-label="Cancel dictation"><X aria-hidden="true" /></button>}
            </div> : <button className="expandable-dictation-start" type="button" onClick={() => { void startExpandedDictation() }} disabled={dictationDisabled || textareaProps.disabled || textareaProps.readOnly}><Mic aria-hidden="true" /> Dictation</button>)}
            <button className="expandable-text-apply" type="button" onClick={applyDraft} disabled={expandedDictation}>Apply</button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </>
})

export default ExpandableTextInput
