import { useId, type ReactNode } from 'react'
import './feedback.css'

export type TabItem = {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export default function Tabs({ label, items, value, onChange }: {
  label: string
  items: TabItem[]
  value: string
  onChange: (value: string) => void
}) {
  const tabsId = useId()

  function move(current: number, direction: 1 | -1) {
    for (let step = 1; step <= items.length; step += 1) {
      const next = (current + direction * step + items.length) % items.length
      if (!items[next].disabled) {
        onChange(items[next].value)
        requestAnimationFrame(() => document.getElementById(`${tabsId}-${items[next].value}`)?.focus())
        return
      }
    }
  }

  return <div className="arc-tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => <button
      id={`${tabsId}-${item.value}`}
      key={item.value}
      type="button"
      role="tab"
      aria-selected={item.value === value}
      tabIndex={item.value === value ? 0 : -1}
      disabled={item.disabled}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1) }
      }}
    >{item.icon}<span>{item.label}</span></button>)}
  </div>
}
