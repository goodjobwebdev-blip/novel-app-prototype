import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import './theme-choice.css'

type ThemeChoiceProps = {
  name: string
  subtitle?: string
  background: string
  border: string
  accent: string
  selected: boolean
  onSelect: () => void
  actions?: ReactNode
  className?: string
}

export default function ThemeChoice({ name, subtitle, background, border, accent, selected, onSelect, actions, className = '' }: ThemeChoiceProps) {
  return <div className={`arc-theme-choice ${selected ? 'selected' : ''} ${className}`.trim()}>
    <button className="arc-theme-choice__select" aria-pressed={selected} type="button" onClick={onSelect}>
      <i className="arc-theme-choice__swatch" style={{ background, borderColor: border }} aria-hidden="true"><b style={{ background: accent }} /></i>
      <span><strong>{name}</strong>{subtitle && <small>{subtitle}</small>}</span>
      {selected && <Check aria-hidden="true" />}
    </button>
    {actions && <div className="arc-theme-choice__actions">{actions}</div>}
  </div>
}
