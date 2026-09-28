import { Children, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import './choice.css'

export type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'children' | 'title' | 'type'> & {
  type?: 'checkbox' | 'radio'
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  badges?: ReactNode
}

export default function Choice({
  type = 'checkbox',
  title,
  description,
  meta,
  badges,
  className = '',
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: ChoiceProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const titleId = `${fieldId}-title`
  const descriptionId = description ? `${fieldId}-description` : undefined
  const metaId = meta ? `${fieldId}-meta` : undefined
  const labelledBy = [ariaLabelledBy, titleId].filter(Boolean).join(' ')
  const describedBy = [ariaDescribedBy, descriptionId, metaId].filter(Boolean).join(' ') || undefined
  const badgeItems = Children.toArray(badges)

  return <label className={`arc-rich-choice ${className}`.trim()} htmlFor={fieldId}>
    <input {...props} id={fieldId} type={type} aria-labelledby={labelledBy} aria-describedby={describedBy} />
    <span className="arc-rich-choice__content">
      <span className="arc-rich-choice__heading">
        <span className="arc-rich-choice__title" id={titleId}>{title}</span>
        {meta && <span className="arc-rich-choice__meta" id={metaId}>{meta}</span>}
      </span>
      {description && <span className="arc-rich-choice__description" id={descriptionId}>{description}</span>}
      {badgeItems.length > 0 && <span className="arc-rich-choice__badges">{badgeItems.map((badge, index) => <span className="arc-rich-choice__badge" key={index}>{badge}</span>)}</span>}
    </span>
  </label>
}
