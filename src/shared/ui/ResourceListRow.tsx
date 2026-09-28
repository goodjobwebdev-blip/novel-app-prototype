import type { ReactNode } from 'react'
import './resource-list-row.css'

export default function ResourceListRow({ icon, title, meta, selected = false, actions, onOpen, className = '' }: {
  icon?: ReactNode
  title: ReactNode
  meta?: ReactNode
  selected?: boolean
  actions?: ReactNode
  onOpen: () => void
  className?: string
}) {
  return <article className={`arc-resource-row ${selected ? 'selected' : ''} ${icon ? '' : 'without-icon'} ${className}`.trim()}>
    <button className="arc-resource-row__open" type="button" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
      {icon && <span className="arc-resource-row__icon" aria-hidden="true">{icon}</span>}
      <span className="arc-resource-row__copy"><strong>{title}</strong>{meta && <small>{meta}</small>}</span>
    </button>
    {actions && <div className="arc-resource-row__actions">{actions}</div>}
  </article>
}
