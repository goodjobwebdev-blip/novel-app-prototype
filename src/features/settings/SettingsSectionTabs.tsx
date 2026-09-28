import Tabs from '../../shared/ui/Tabs'
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
  return <Tabs
    className="settings-section-tabs"
    label={label}
    value={active}
    onChange={onChange}
    items={tabs.map(([tab, tabLabel]) => ({
      value: tab,
      label: tabLabel,
      id: `${idPrefix}-tab-${tab}`,
      panelId: `${idPrefix}-panel-${tab}`,
    }))}
  />
}
