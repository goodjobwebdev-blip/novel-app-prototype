import type { ReactNode } from 'react'
import './primitives.css'

export default function PanelHeader({ eyebrow, title, actions, className = '' }: {
  eyebrow?: ReactNode
  title: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return <header className={`arc-panel-header ${className}`.trim()}>
    <div className="arc-panel-header__copy">
      {eyebrow && <small>{eyebrow}</small>}
      <h2>{title}</h2>
    </div>
    {actions && <div className="arc-panel-header__actions">{actions}</div>}
  </header>
}
