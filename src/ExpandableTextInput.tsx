import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ForwardedRef,
  type TextareaHTMLAttributes,
} from 'react'
import { Expand, X } from 'lucide-react'
import { createPortal } from 'react-dom'

type ExpandableTextInputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  dialogTitle?: string
}

function assignRef(ref: ForwardedRef<HTMLTextAreaElement>, value: HTMLTextAreaElement | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

const ExpandableTextInput = forwardRef<HTMLTextAreaElement, ExpandableTextInputProps>(function ExpandableTextInput({
  value,
  onChange,
  dialogTitle = 'Edit prompt',
  'aria-label': ariaLabel = 'Generation prompt',
  ...textareaProps
}, forwardedRef) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const compactRef = useRef<HTMLTextAreaElement | null>(null)
  const expandedRef = useRef<HTMLTextAreaElement | null>(null)
  const titleId = useId()

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
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeDialog()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open])

  function returnFocus() {
    requestAnimationFrame(() => compactRef.current?.focus())
  }

  function openDialog() {
    setDraft(value)
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    returnFocus()
  }

  function applyDraft() {
    onChange(draft)
    setOpen(false)
    returnFocus()
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
        <section className="expandable-text-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <header>
            <h2 id={titleId}>{dialogTitle}</h2>
            <button type="button" onClick={closeDialog} aria-label="Close expanded editor" title="Close expanded editor">
              <X aria-hidden="true" />
            </button>
          </header>
          <textarea ref={expandedRef} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Expanded ${ariaLabel}`} readOnly={textareaProps.readOnly} disabled={textareaProps.disabled} spellCheck={textareaProps.spellCheck} />
          <footer>
            <button type="button" onClick={applyDraft}>Apply</button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </>
})

export default ExpandableTextInput
