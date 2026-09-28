import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import './segmented-control.css'

export type SegmentedControlOption<Value extends string = string> = {
  value: Value
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export type SegmentedControlProps<Value extends string = string> = {
  label: string
  value: Value
  options: SegmentedControlOption<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
  fullWidth?: boolean
  className?: string
}

export default function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  fullWidth = false,
  className = '',
}: SegmentedControlProps<Value>) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled)

  function select(index: number) {
    const option = options[index]
    if (!option || disabled || option.disabled) return
    onChange(option.value)
    optionRefs.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabled = options.map((option, optionIndex) => ({ option, optionIndex })).filter(({ option }) => !option.disabled)
    if (disabled || !enabled.length) return

    let nextIndex: number | undefined
    if (event.key === 'Home') nextIndex = enabled[0].optionIndex
    if (event.key === 'End') nextIndex = enabled[enabled.length - 1].optionIndex
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
      const current = enabled.findIndex(item => item.optionIndex === index)
      nextIndex = enabled[(current + direction + enabled.length) % enabled.length].optionIndex
    }

    if (nextIndex !== undefined) {
      event.preventDefault()
      select(nextIndex)
    }
  }

  return <div
    className={`arc-segmented-control${fullWidth ? ' arc-segmented-control--full' : ''}${className ? ` ${className}` : ''}`}
    role="radiogroup"
    aria-label={label}
    aria-disabled={disabled || undefined}
  >
    {options.map((option, index) => <button
      ref={element => { optionRefs.current[index] = element }}
      className="arc-segmented-control__option"
      key={option.value}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      tabIndex={index === tabStopIndex ? 0 : -1}
      disabled={disabled || option.disabled}
      onClick={() => select(index)}
      onKeyDown={event => handleKeyDown(event, index)}
    >
      {option.icon && <span className="arc-segmented-control__icon" aria-hidden="true">{option.icon}</span>}
      <span>{option.label}</span>
    </button>)}
  </div>
}
