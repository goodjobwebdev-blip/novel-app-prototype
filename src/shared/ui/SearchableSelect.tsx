import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import SearchField from './SearchField'
import './searchable-select.css'

function scheduleFrame(callback: FrameRequestCallback) {
  return typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(callback) : window.setTimeout(() => callback(performance.now()), 0)
}

function cancelFrame(handle: number) {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle)
  else window.clearTimeout(handle)
}

export type SearchableSelectOption = {
  value: string
  title: string
  subtitle?: string
  leadingIcon?: ReactNode
  meta?: ReactNode
  badges?: string[]
  disabled?: boolean
}

type SearchableSelectProps = {
  label: string
  value?: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  description?: string
  disabled?: boolean
}

export default function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search options',
  emptyText = 'No matching options',
  description,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mobile, setMobile] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listId = useId()
  const labelId = useId()
  const selected = options.find(option => option.value === value)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return options
    return options.filter(option => [option.title, option.subtitle, option.badges?.join(' ')].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized))
  }, [options, query])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 720px)')
    const sync = () => setMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!open) return
    if (mobile) dialogRef.current?.showModal()
    const frame = scheduleFrame(() => searchRef.current?.focus())
    return () => {
      cancelFrame(frame)
      if (dialogRef.current?.open) dialogRef.current.close()
    }
  }, [open, mobile])

  useEffect(() => {
    if (!open || mobile) return
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, mobile])

  function openSelect() {
    if (disabled) return
    setQuery('')
    setOpen(true)
  }

  function close(restoreFocus = true) {
    setOpen(false)
    if (restoreFocus) scheduleFrame(() => triggerRef.current?.focus())
  }

  function choose(option: SearchableSelectOption) {
    if (option.disabled) return
    onChange(option.value)
    close()
  }

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.arc-searchable-select__option:not(:disabled)')]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1
    items[next]?.focus()
  }

  const optionList = <>
    <SearchField ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
    <div className="arc-searchable-select__options" id={listId} role="listbox" aria-labelledby={labelId}>
      {filtered.map(option => <button
        key={option.value}
        type="button"
        className="arc-searchable-select__option"
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        onClick={() => choose(option)}
      >
        {option.leadingIcon && <span className="arc-searchable-select__option-icon">{option.leadingIcon}</span>}
        <span className="arc-searchable-select__option-copy"><strong>{option.title}</strong>{option.subtitle && <small>{option.subtitle}</small>}{option.badges?.length && <span className="arc-searchable-select__badges">{option.badges.map(badge => <em key={badge}>{badge}</em>)}</span>}</span>
        {option.meta && <span className="arc-searchable-select__meta">{option.meta}</span>}
        {option.value === value && <Check className="arc-searchable-select__check" aria-hidden="true" />}
      </button>)}
      {!filtered.length && <p className="arc-searchable-select__empty">{emptyText}</p>}
    </div>
  </>

  return <div ref={rootRef} className="arc-searchable-select">
    <span className="arc-searchable-select__label" id={labelId}>{label}</span>
    <button ref={triggerRef} className={`arc-searchable-select__trigger ${selected?.leadingIcon ? 'has-icon' : ''}`.trim()} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => open ? close(false) : openSelect()} onKeyDown={event => {
      if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSelect() }
    }}>
      {selected?.leadingIcon && <span className="arc-searchable-select__trigger-icon">{selected.leadingIcon}</span>}
      <span><strong>{selected?.title ?? placeholder}</strong>{selected?.subtitle && <small>{selected.subtitle}</small>}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {description && <small className="arc-searchable-select__description">{description}</small>}
    {open && (mobile ? createPortal(<dialog ref={dialogRef} className="arc-searchable-select__modal" aria-labelledby={labelId} onCancel={event => { event.preventDefault(); close() }} onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
      <section onKeyDown={handleKeys}>
        <header><strong>{label}</strong><button type="button" onClick={() => close()} aria-label={`Close ${label}`}><X aria-hidden="true" /></button></header>
        {optionList}
      </section>
    </dialog>, document.body) : <div className="arc-searchable-select__panel" onKeyDown={handleKeys}>{optionList}</div>)}
  </div>
}
