import type { DetailsHTMLAttributes, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import './disclosure.css'

export type DisclosureProps = Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  bodyClassName?: string
}

export default function Disclosure({ title, description, eyebrow, bodyClassName = '', className = '', children, ...props }: DisclosureProps) {
  return <details {...props} className={`arc-disclosure ${className}`.trim()}>
    <summary>
      <span className="arc-disclosure__copy">
        {eyebrow && <small className="arc-disclosure__eyebrow">{eyebrow}</small>}
        <strong>{title}</strong>
        {description && <span className="arc-disclosure__description">{description}</span>}
      </span>
      <ChevronDown aria-hidden="true" />
    </summary>
    <div className={`arc-disclosure__body ${bodyClassName}`.trim()}>{children}</div>
  </details>
}
