import type { UiTypography } from '../../features/settings/ui-settings'
import { fontOptions } from '../../features/settings/ui-settings'
import Button from './Button'
import SearchableSelect from './SearchableSelect'
import './typography-controls.css'

function RangeControl({ label, value, min, max, step, suffix = '', onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return <label className="arc-typography-range">
    <span><strong>{label}</strong><em>{value}{suffix}</em></span>
    <div><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><input aria-label={`${label} exact value`} type="number" min={min} max={max} step={step} value={value} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></div>
  </label>
}

export default function TypographyControls({ title, description, value, onChange, onReset }: {
  title: string
  description: string
  value: UiTypography
  onChange: (value: UiTypography) => void
  onReset: () => void
}) {
  return <section className="arc-typography-controls">
    <header><div><strong>{title}</strong><p>{description}</p></div><Button size="small" variant="ghost" onClick={onReset}>Reset</Button></header>
    <SearchableSelect label="Font family" value={value.fontFamily} onChange={fontFamily => onChange({ ...value, fontFamily })} searchPlaceholder="Search fonts" options={fontOptions.map(font => ({ value: font.family, title: font.label, subtitle: font.bundled ? 'Bundled · available offline' : 'System font', meta: font.kind }))} />
    <div className="arc-typography-ranges">
      <RangeControl label="Font size" value={value.fontSize} min={10} max={48} step={1} suffix="px" onChange={fontSize => onChange({ ...value, fontSize })} />
      <RangeControl label="Line height" value={value.lineHeight} min={1} max={2.6} step={0.05} onChange={lineHeight => onChange({ ...value, lineHeight })} />
      <RangeControl label="Font weight" value={value.fontWeight} min={100} max={900} step={50} onChange={fontWeight => onChange({ ...value, fontWeight })} />
    </div>
  </section>
}
