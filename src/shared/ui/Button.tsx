import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './primitives.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'small' | 'medium' | 'large'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export default function Button({
  variant = 'secondary',
  size = 'medium',
  loading = false,
  leadingIcon,
  trailingIcon,
  className = '',
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = ['arc-button', `arc-button--${variant}`, `arc-button--${size}`, className].filter(Boolean).join(' ')

  return <button {...props} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <span className="arc-button__spinner" aria-hidden="true" /> : leadingIcon ? <span className="arc-button__icon" aria-hidden="true">{leadingIcon}</span> : null}
    {children && <span>{children}</span>}
    {!loading && trailingIcon ? <span className="arc-button__icon" aria-hidden="true">{trailingIcon}</span> : null}
  </button>
}
