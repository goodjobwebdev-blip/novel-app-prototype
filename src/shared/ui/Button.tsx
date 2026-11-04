import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import './primitives.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'small' | 'medium' | 'large'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>
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

export type IconButtonProps = Omit<ButtonProps, 'size' | 'leadingIcon' | 'trailingIcon'> & {
  'aria-label': string
}

/** Compact native action: the visible border box is also the complete hit box. */
export function IconButton({
  variant = 'ghost', loading = false, disabled, className = '',
  type = 'button', title, children, 'aria-label': label, ...props
}: IconButtonProps) {
  return <button {...props} type={type} aria-label={label} title={title ?? label}
    className={`arc-button arc-button--${variant} arc-icon-button ${className}`.trim()}
    disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <span className="arc-button__spinner" aria-hidden="true" />
      : <span className="arc-icon-button__content" aria-hidden="true">{children}</span>}
  </button>
}
