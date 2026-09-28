import { useEffect, type ReactNode } from 'react'
import { CheckCircle2, CircleX, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import './feedback.css'

export type ToastVariant = 'success' | 'warning' | 'error'
export type ToastAction = { label: string; onClick: () => void; ariaLabel?: string; disabled?: boolean }

export default function Toast({ variant, title, children, action, onDismiss, fixed = false, duration = 0 }: {
  variant: ToastVariant
  title: string
  children?: ReactNode
  action?: ToastAction
  onDismiss?: () => void
  fixed?: boolean
  duration?: number
}) {
  useEffect(() => {
    if (!duration || !onDismiss) return
    const timer = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(timer)
  }, [duration, onDismiss])

  const Icon = variant === 'success' ? CheckCircle2 : variant === 'warning' ? TriangleAlert : CircleX
  const content = <article className={`arc-toast arc-toast--${variant} ${fixed ? 'arc-toast--fixed' : ''}`} role={variant === 'error' ? 'alert' : 'status'}>
    <Icon className="arc-toast__icon" aria-hidden="true" />
    <div><strong>{title}</strong>{children && <p>{children}</p>}</div>
    {action && <button className="arc-toast__action" type="button" onClick={action.onClick} aria-label={action.ariaLabel} disabled={action.disabled}>{action.label}</button>}
    {onDismiss && <button className="arc-toast__dismiss" type="button" onClick={onDismiss} aria-label={`Dismiss ${title}`}><X aria-hidden="true" /></button>}
  </article>

  return fixed ? createPortal(content, document.body) : content
}
