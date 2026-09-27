import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import './primitives.css'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  description?: ReactNode
  error?: string
  leadingIcon?: ReactNode
}

export default function Input({
  label,
  description,
  error,
  leadingIcon,
  id,
  className = '',
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return <label className={`arc-field ${error ? 'arc-field--error' : ''} ${className}`.trim()} htmlFor={inputId}>
    {label && <span className="arc-field__label">{label}</span>}
    <span className="arc-input-wrap">
      {leadingIcon && <span className="arc-input__icon" aria-hidden="true">{leadingIcon}</span>}
      <input {...props} id={inputId} className="arc-input" aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy} />
    </span>
    {description && <small className="arc-field__description" id={descriptionId}>{description}</small>}
    {error && <small className="arc-field__error" id={errorId}>{error}</small>}
  </label>
}
