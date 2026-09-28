import { useId } from 'react'
import './primitives.css'

export type RadioOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export type RadioGroupProps = {
  label: string
  name: string
  value: string
  options: RadioOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

export default function RadioGroup({ label, name, value, options, onChange, disabled = false }: RadioGroupProps) {
  const groupId = useId()

  return <fieldset className="arc-radio-group" aria-labelledby={groupId} disabled={disabled}>
    <legend id={groupId}>{label}</legend>
    <div>{options.map(option => <label className="arc-choice" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
      <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
    </label>)}</div>
  </fieldset>
}
