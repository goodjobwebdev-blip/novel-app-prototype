import { useId, type ReactNode } from 'react'
import './feedback.css'

export type TabItem<T extends string = string> = {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
  id?: string
  panelId?: string
  ariaControls?: string
}

type TabsProps<T extends string> = {
  label: string
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}

export default function Tabs<T extends string>({ label, items, value, onChange, className }: TabsProps<T>) {
  const tabsId = useId()
  const tabId = (item: TabItem<T>) => item.id ?? `${tabsId}-${item.value}`

  function select(item: TabItem<T>) {
    onChange(item.value)
    requestAnimationFrame(() => document.getElementById(tabId(item))?.focus())
  }

  function move(current: number, direction: 1 | -1) {
    for (let step = 1; step <= items.length; step += 1) {
      const next = (current + direction * step + items.length) % items.length
      if (!items[next].disabled) {
        select(items[next])
        return
      }
    }
  }

  function moveToEnd(direction: 1 | -1) {
    const start = direction === 1 ? 0 : items.length - 1
    for (let index = start; index >= 0 && index < items.length; index += direction) {
      if (!items[index].disabled) {
        select(items[index])
        return
      }
    }
  }

  return <div className={['arc-tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={label}>
    {items.map((item, index) => <button
      id={tabId(item)}
      key={item.value}
      type="button"
      role="tab"
      aria-controls={item.ariaControls ?? item.panelId}
      aria-selected={item.value === value}
      tabIndex={item.value === value ? 0 : -1}
      disabled={item.disabled}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1) }
        if (event.key === 'Home') { event.preventDefault(); moveToEnd(1) }
        if (event.key === 'End') { event.preventDefault(); moveToEnd(-1) }
      }}
    >{item.icon}<span>{item.label}</span></button>)}
  </div>
}
