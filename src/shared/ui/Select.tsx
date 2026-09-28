import { useId, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import './primitives.css'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string
  description?: string
  error?: string
}

export default function Select({ label, description, error, className = '', id, children, ...props }: SelectProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = description ? `${fieldId}-description` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return <label className={`arc-field ${error ? 'arc-field--error' : ''} ${className}`.trim()} htmlFor={fieldId}>
    {label && <span className="arc-field__label">{label}</span>}
    <span className="arc-select-wrap">
      <select {...props} id={fieldId} className="arc-select" aria-invalid={error ? true : undefined} aria-describedby={describedBy}>{children}</select>
      <ChevronDown aria-hidden="true" />
    </span>
    {description && <span className="arc-field__description" id={descriptionId}>{description}</span>}
    {error && <span className="arc-field__error" id={errorId}>{error}</span>}
  </label>
}
