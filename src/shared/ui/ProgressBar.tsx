import './feedback.css'

export type ProgressVariant = 'default' | 'success' | 'warning' | 'error'

export default function ProgressBar({ label, value = 0, max = 100, variant = 'default', showValue = true, showLabel = true, compact = false, indeterminate = false }: {
  label: string
  value?: number
  max?: number
  variant?: ProgressVariant
  showValue?: boolean
  showLabel?: boolean
  compact?: boolean
  indeterminate?: boolean
}) {
  const safeMax = max > 0 ? max : 100
  const safeValue = Math.min(Math.max(value, 0), safeMax)
  const percentage = Math.round((safeValue / safeMax) * 100)

  return <div className={`arc-progress arc-progress--${variant} ${compact ? 'arc-progress--compact' : ''} ${indeterminate ? 'arc-progress--indeterminate' : ''}`.trim()}>
    {showLabel && <div><span>{label}</span>{showValue && !indeterminate && <strong>{percentage}%</strong>}</div>}
    <div className="arc-progress__track" role="progressbar" aria-label={label} aria-valuemin={indeterminate ? undefined : 0} aria-valuemax={indeterminate ? undefined : safeMax} aria-valuenow={indeterminate ? undefined : safeValue}>
      <i style={indeterminate ? undefined : { width: `${percentage}%` }} />
    </div>
  </div>
}
