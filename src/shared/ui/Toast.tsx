import { useEffect, type ReactNode } from 'react'
import { CheckCircle2, CircleX, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import './feedback.css'

export type ToastVariant = 'success' | 'warning' | 'error'

export default function Toast({ variant, title, children, onDismiss, fixed = false, duration = 0 }: {
  variant: ToastVariant
  title: string
  children?: ReactNode
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
    {onDismiss && <button type="button" onClick={onDismiss} aria-label={`Dismiss ${title}`}><X aria-hidden="true" /></button>}
  </article>

  return fixed ? createPortal(content, document.body) : content
}
