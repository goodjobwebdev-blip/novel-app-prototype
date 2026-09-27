import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Palette, Plus, Search, Trash2 } from 'lucide-react'
import { builtInThemes, loadUiSettings, saveUiSettings, UI_SETTINGS_EVENT, type UiSettings } from '../../features/settings/ui-settings'
import Button from './Button'
import Card from './Card'
import Input from './Input'
import './ui-kit.css'

export default function UiKitScreen({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<UiSettings>(() => loadUiSettings())
  const [saveError, setSaveError] = useState('')
  const [sampleTitle, setSampleTitle] = useState('The City Beneath the Tide')

  useEffect(() => {
    const sync = (event: Event) => setSettings((event as CustomEvent<UiSettings>).detail ?? loadUiSettings())
    window.addEventListener(UI_SETTINGS_EVENT, sync)
    return () => window.removeEventListener(UI_SETTINGS_EVENT, sync)
  }, [])

  function selectTheme(activeThemeId: string) {
    try {
      const next = saveUiSettings({ ...settings, activeThemeId })
      setSettings(next)
      setSaveError('')
    } catch {
      setSaveError('Theme could not be saved on this device.')
    }
  }

  const themes = [...builtInThemes, ...settings.customThemes.map(theme => ({ ...theme, tone: 'dark' as const }))]

  return <main className="ui-kit-screen">
    <header className="ui-kit-topbar">
      <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={onBack}>Library</Button>
      <div><Palette aria-hidden="true" /><span>ARC UI KIT</span></div>
      <span className="ui-kit-status">Internal</span>
    </header>

    <div className="ui-kit-content">
      <header className="ui-kit-heading">
        <div><small>Design system</small><h1>Component gallery</h1><p>The shared components below use the same themes and tokens as the application.</p></div>
        <span>{settings.inputs.fontFamily} · {settings.inputs.fontSize}px</span>
      </header>

      <Card eyebrow="Theme tester" title="Themes" description="Changes are applied globally and saved using the existing Appearance settings.">
        <div className="ui-kit-themes" role="group" aria-label="Select theme">
          {themes.map(theme => <button key={theme.id} className={settings.activeThemeId === theme.id ? 'selected' : ''} type="button" onClick={() => selectTheme(theme.id)} aria-pressed={settings.activeThemeId === theme.id}>
            <i style={{ background: theme.palette.background, borderColor: theme.palette.border }}><b style={{ background: theme.palette.accent }} /></i>
            <span>{theme.name}</span>
            {settings.activeThemeId === theme.id && <Check aria-hidden="true" />}
          </button>)}
        </div>
        {saveError && <p className="ui-kit-error" role="alert">{saveError}</p>}
      </Card>

      <section className="ui-kit-section" aria-labelledby="ui-kit-buttons">
        <header><small>01</small><div><h2 id="ui-kit-buttons">Buttons</h2><p>Semantic variants, three sizes, and common interaction states.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-row">
            <Button variant="primary" leadingIcon={<Plus />}>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leadingIcon={<Trash2 />}>Delete</Button>
          </div>
          <div className="ui-kit-row">
            <Button size="small">Small</Button>
            <Button size="medium">Medium</Button>
            <Button size="large">Large</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-inputs">
        <header><small>02</small><div><h2 id="ui-kit-inputs">Inputs</h2><p>Labels, descriptions, validation, icons, and disabled state.</p></div></header>
        <Card variant="outlined">
          <div className="ui-kit-input-grid">
            <Input label="Book title" value={sampleTitle} onChange={event => setSampleTitle(event.target.value)} description="Shown in the library and workspace." />
            <Input label="Search" leadingIcon={<Search />} placeholder="Search components" type="search" />
            <Input label="API key" error="An API key is required." placeholder="Enter API key" type="password" />
            <Input label="Unavailable field" value="Disabled value" disabled readOnly />
          </div>
        </Card>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-cards">
        <header><small>03</small><div><h2 id="ui-kit-cards">Cards</h2><p>Shared containers for settings, grouped content, and elevated surfaces.</p></div></header>
        <div className="ui-kit-card-grid">
          <Card eyebrow="Default" title="Standard card" description="The normal container for grouped application content."><p>Use this for most sections before adding another visual variant.</p></Card>
          <Card variant="elevated" eyebrow="Elevated" title="Raised card" description="Reserved for content that must sit above its surroundings." action={<Button size="small">Action</Button>}><p>Elevation communicates hierarchy, not decoration.</p></Card>
          <Card variant="outlined" eyebrow="Outlined" title="Quiet card" description="A lower-emphasis boundary with no filled surface."><p>Useful inside another card or on a stable background.</p></Card>
        </div>
      </section>
    </div>
  </main>
}
