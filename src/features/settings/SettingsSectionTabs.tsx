import type { KeyboardEvent } from 'react'
import './settings-section-tabs.css'

export type SettingsSectionTab<T extends string> = readonly [T, string]

type SettingsSectionTabsProps<T extends string> = {
  tabs: ReadonlyArray<SettingsSectionTab<T>>
  active: T
  onChange: (tab: T) => void
  idPrefix: string
  label: string
}

export default function SettingsSectionTabs<T extends string>({ tabs, active, onChange, idPrefix, label }: SettingsSectionTabsProps<T>) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : -1
    if (next < 0) return
    event.preventDefault()
    const tab = tabs[next][0]
    onChange(tab)
    document.getElementById(`${idPrefix}-tab-${tab}`)?.focus()
  }

  return <div className="settings-section-tabs" role="tablist" aria-label={label}>
    {tabs.map(([tab, tabLabel], index) => <button
      key={tab}
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${tab}`}
      aria-controls={`${idPrefix}-panel-${tab}`}
      aria-selected={active === tab}
      tabIndex={active === tab ? 0 : -1}
      onClick={() => onChange(tab)}
      onKeyDown={(event) => selectFromKeyboard(event, index)}
    >{tabLabel}</button>)}
  </div>
}
