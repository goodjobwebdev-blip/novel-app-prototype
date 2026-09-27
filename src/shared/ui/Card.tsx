import type { HTMLAttributes, ReactNode } from 'react'
import './primitives.css'

export type CardVariant = 'default' | 'elevated' | 'outlined'

export type CardProps = HTMLAttributes<HTMLElement> & {
  variant?: CardVariant
  eyebrow?: string
  title?: string
  description?: string
  action?: ReactNode
}

export default function Card({
  variant = 'default',
  eyebrow,
  title,
  description,
  action,
  className = '',
  children,
  ...props
}: CardProps) {
  const hasHeader = eyebrow || title || description || action
  return <section {...props} className={`arc-card arc-card--${variant} ${className}`.trim()}>
    {hasHeader && <header className="arc-card__header">
      <div>
        {eyebrow && <small>{eyebrow}</small>}
        {title && <h3>{title}</h3>}
        {description && <p>{description}</p>}
      </div>
      {action && <div className="arc-card__action">{action}</div>}
    </header>}
    {children && <div className="arc-card__body">{children}</div>}
  </section>
}
