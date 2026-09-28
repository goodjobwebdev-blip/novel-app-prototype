import { useId, type InputHTMLAttributes } from 'react'
import './primitives.css'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string
  description?: string
}

export default function Checkbox({ label, description, className = '', id, ...props }: CheckboxProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = description ? `${fieldId}-description` : undefined

  return <label className={`arc-choice ${className}`.trim()} htmlFor={fieldId}>
    <input {...props} id={fieldId} type="checkbox" aria-describedby={descriptionId} />
    <span><strong>{label}</strong>{description && <small id={descriptionId}>{description}</small>}</span>
  </label>
}
