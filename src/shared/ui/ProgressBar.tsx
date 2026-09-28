import './feedback.css'

export type ProgressVariant = 'default' | 'success' | 'warning' | 'error'

export default function ProgressBar({ label, value, max = 100, variant = 'default', showValue = true }: {
  label: string
  value: number
  max?: number
  variant?: ProgressVariant
  showValue?: boolean
}) {
  const safeMax = max > 0 ? max : 100
  const safeValue = Math.min(Math.max(value, 0), safeMax)
  const percentage = Math.round((safeValue / safeMax) * 100)

  return <div className={`arc-progress arc-progress--${variant}`}>
    <div><span>{label}</span>{showValue && <strong>{percentage}%</strong>}</div>
    <div className="arc-progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={safeMax} aria-valuenow={safeValue}>
      <i style={{ width: `${percentage}%` }} />
    </div>
  </div>
}
