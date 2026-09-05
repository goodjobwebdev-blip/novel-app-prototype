import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Palette, Plus, Search, Trash2, Type } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  UI_SETTINGS_EVENT,
  builtInThemes,
  createCustomTheme,
  fontOptions,
  fontStack,
  loadUiSettings,
  resolveTheme,
  saveUiSettings,
  type CustomUiTheme,
  type ThemePalette,
  type UiSettings,
  type UiTypography,
} from './ui-settings'

type TypographyKey = keyof UiTypography

function RangeSetting({ label, value, min, max, step, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="ui-range-setting">
    <span><strong>{label}</strong><b>{Number.isInteger(value) ? value : value.toFixed(2)}{suffix}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
}

function FontPicker({ label, value, onChange }: { label: string; value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const current = fontOptions.find((font) => font.family === value) ?? fontOptions[0]
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return fontOptions.filter((font) => !normalized || `${font.label} ${font.kind}`.toLowerCase().includes(normalized))
  }, [query])

  useEffect(() => {
    if (!open) return
    function close(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return <div className="ui-font-field" ref={wrapRef}>
    <span>{label}</span>
    <button className="ui-font-picker-trigger" type="button" onClick={() => { setOpen((value) => !value); setQuery('') }} aria-expanded={open}>
      <span style={{ fontFamily: current.stack }}>{current.label}</span>
      <small>{current.bundled ? 'Bundled' : 'System'}</small>
    </button>
    {open && <div className="ui-font-picker-popover">
      <label className="ui-font-search"><Search aria-hidden="true" /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fonts" /></label>
      <div className="ui-font-list" role="listbox" aria-label={label}>
        {visible.map((font) => <button key={font.family} className={font.family === value ? 'selected' : ''} type="button" role="option" aria-selected={font.family === value} onClick={() => { onChange(font.family); setOpen(false) }}>
          <span style={{ fontFamily: font.stack }}>{font.label}</span><small>{font.kind}{font.bundled ? ' · offline' : ' · system'}</small>{font.family === value && <Check aria-hidden="true" />}
        </button>)}
        {!visible.length && <p>No matching fonts.</p>}
      </div>
    </div>}
  </div>
}

function TypographySection({ number, title, description, value, onChange }: { number: string; title: string; description: string; value: UiTypography; onChange: (value: UiTypography) => void }) {
  const update = (key: TypographyKey, next: string | number) => onChange({ ...value, [key]: next })
  return <section className="settings-card ui-typography-card">
    <div className="card-heading"><div><span>{number}</span><h2>{title}</h2></div><p>{description}</p></div>
    <FontPicker label="Font family" value={value.fontFamily} onChange={(family) => update('fontFamily', family)} />
    <div className="ui-range-grid">
      <RangeSetting label="Font size" value={value.fontSize} min={12} max={32} step={1} suffix=" px" onChange={(next) => update('fontSize', next)} />
      <RangeSetting label="Line height" value={value.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(next) => update('lineHeight', next)} />
      <RangeSetting label="Font weight" value={value.fontWeight} min={300} max={700} step={50} onChange={(next) => update('fontWeight', next)} />
    </div>
    <div className="ui-type-preview" style={{ fontFamily: fontStack(value.fontFamily), fontSize: value.fontSize, lineHeight: value.lineHeight, fontWeight: value.fontWeight }}>
      The quiet room held its breath while the next sentence arrived.
    </div>
  </section>
}

const colorLabels: Array<[keyof ThemePalette, string]> = [
  ['background', 'Background'],
  ['elevated', 'Elevated surface'],
  ['editor', 'Editor background'],
  ['text', 'Primary text'],
  ['muted', 'Muted text'],
  ['border', 'Border'],
  ['accent', 'Accent'],
  ['accentActive', 'Accent active'],
  ['selection', 'Selection'],
  ['error', 'Error'],
]

function ThemeSwatch({ palette }: { palette: ThemePalette }) {
  return <span className="ui-theme-swatch" style={{ background: palette.background, borderColor: palette.border }}>
    <i style={{ background: palette.editor }} /><b style={{ background: palette.accent }} /><em style={{ color: palette.text }}>Aa</em>
  </span>
}

function ThemeOption({ id, name, palette, active, custom, onSelect, onDuplicate, onDelete }: { id: string; name: string; palette: ThemePalette; active: boolean; custom?: boolean; onSelect: () => void; onDuplicate: () => void; onDelete?: () => void }) {
  return <div className={`ui-theme-option ${active ? 'selected' : ''}`} data-theme-id={id}>
    <button className="ui-theme-select" type="button" onClick={onSelect}>
      <ThemeSwatch palette={palette} />
      <span><strong>{name}</strong><small>{custom ? 'Custom theme' : 'Built in'}</small></span>
      {active && <Check aria-hidden="true" />}
    </button>
    <div className="ui-theme-actions">
      <button type="button" onClick={onDuplicate} aria-label={`Duplicate ${name}`} title="Duplicate to customize"><Copy aria-hidden="true" /></button>
      {custom && onDelete && <button className="danger" type="button" onClick={onDelete} aria-label={`Delete ${name}`} title="Delete theme"><Trash2 aria-hidden="true" /></button>}
    </div>
  </div>
}

function ThemeEditor({ theme, onChange }: { theme: CustomUiTheme; onChange: (theme: CustomUiTheme) => void }) {
  return <section className="ui-theme-editor">
    <header><div><Palette aria-hidden="true" /><span><strong>Customize theme</strong><small>Semantic colors are applied across the interface.</small></span></div></header>
    <label className="ui-theme-name"><span>Theme name</span><input value={theme.name} maxLength={80} onChange={(event) => onChange({ ...theme, name: event.target.value })} /></label>
    <div className="ui-color-grid">
      {colorLabels.map(([key, label]) => <label key={key}><span>{label}</span><div><input type="color" value={theme.palette[key]} onChange={(event) => onChange({ ...theme, palette: { ...theme.palette, [key]: event.target.value } })} /><code>{theme.palette[key]}</code></div></label>)}
    </div>
    <div className="ui-theme-preview" style={{ background: theme.palette.background, borderColor: theme.palette.border, color: theme.palette.text }}>
      <aside style={{ background: theme.palette.elevated, borderColor: theme.palette.border }}><i style={{ background: theme.palette.accent }} /><span style={{ color: theme.palette.muted }}>Outline</span></aside>
      <article style={{ background: theme.palette.editor }}><small style={{ color: theme.palette.accent }}>SCENE 07</small><p>Theme preview for the writing surface.</p><mark style={{ background: theme.palette.selection, color: theme.palette.text }}>Selected text</mark></article>
    </div>
  </section>
}

function UiSettingsPanel() {
  const [settings, setSettings] = useState<UiSettings>(() => loadUiSettings())
  const activeTheme = resolveTheme(settings)
  const activeCustom = settings.customThemes.find((theme) => theme.id === settings.activeThemeId)

  useEffect(() => {
    const sync = (event: Event) => setSettings((event as CustomEvent<UiSettings>).detail ?? loadUiSettings())
    window.addEventListener(UI_SETTINGS_EVENT, sync)
    return () => window.removeEventListener(UI_SETTINGS_EVENT, sync)
  }, [])

  function commit(transform: (current: UiSettings) => UiSettings) {
    setSettings((current) => saveUiSettings(transform(current)))
  }

  function updateCustomTheme(nextTheme: CustomUiTheme) {
    commit((current) => ({ ...current, customThemes: current.customThemes.map((theme) => theme.id === nextTheme.id ? nextTheme : theme) }))
  }

  function duplicate(themeId: string) {
    setSettings((current) => createCustomTheme(current, themeId))
  }

  function removeCustomTheme(theme: CustomUiTheme) {
    if (!window.confirm(`Delete “${theme.name}”?`)) return
    commit((current) => ({
      ...current,
      activeThemeId: current.activeThemeId === theme.id ? 'very-dark' : current.activeThemeId,
      customThemes: current.customThemes.filter((item) => item.id !== theme.id),
    }))
  }

  return <section className="ui-settings-panel" aria-labelledby="page-title">
    <header className="page-heading"><div><p>Global UI</p><h1 id="page-title">Appearance</h1><span>Applies to every book on this device. UI settings are global and cannot be overridden by a book.</span></div><div className="save-state saved"><i />Saved</div></header>

    <TypographySection number="01" title="Main editor" description="Typography for Scenes, Notes, Codex entries, and summaries." value={settings.editor} onChange={(editor) => commit((current) => ({ ...current, editor }))} />
    <TypographySection number="02" title="Expandable inputs" description="Typography for scalable drawer and chat/context text inputs." value={settings.inputs} onChange={(inputs) => commit((current) => ({ ...current, inputs }))} />

    <section className="settings-card ui-themes-card">
      <div className="card-heading"><div><span>03</span><h2>Themes</h2></div><p>Typography stays independent when the theme changes.</p></div>
      <div className="ui-theme-group"><h3>Built in</h3><div className="ui-theme-grid">
        {builtInThemes.map((theme) => <ThemeOption key={theme.id} id={theme.id} name={theme.name} palette={theme.palette} active={settings.activeThemeId === theme.id} onSelect={() => commit((current) => ({ ...current, activeThemeId: theme.id }))} onDuplicate={() => duplicate(theme.id)} />)}
      </div></div>

      <div className="ui-theme-group ui-custom-themes"><header><h3>Custom</h3><button className="create-theme" type="button" onClick={() => duplicate(activeTheme.id)}><Plus aria-hidden="true" /> Create theme</button></header>
        {settings.customThemes.length ? <div className="ui-theme-grid">{settings.customThemes.map((theme) => <ThemeOption key={theme.id} id={theme.id} name={theme.name} palette={theme.palette} active={settings.activeThemeId === theme.id} custom onSelect={() => commit((current) => ({ ...current, activeThemeId: theme.id }))} onDuplicate={() => duplicate(theme.id)} onDelete={() => removeCustomTheme(theme)} />)}</div> : <p className="ui-custom-empty">Create a theme from the active palette, or duplicate any built-in theme to customize it.</p>}
      </div>

      {activeCustom ? <ThemeEditor theme={activeCustom} onChange={updateCustomTheme} /> : <button className="ui-duplicate-active" type="button" onClick={() => duplicate(activeTheme.id)}><Copy aria-hidden="true" /> Duplicate {activeTheme.name} to customize</button>}
    </section>
  </section>
}

export default function UiSettingsPortalBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    function findTarget() {
      const next = document.querySelector<HTMLElement>('.appearance-settings')
      if (next === current) return
      if (current) current.classList.remove('ui-settings-enhanced')
      current = next
      if (current) current.classList.add('ui-settings-enhanced')
      setTarget(current)
    }
    findTarget()
    const observer = new MutationObserver(findTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (current) current.classList.remove('ui-settings-enhanced')
    }
  }, [])

  return target ? createPortal(<div className="ui-settings-portal"><UiSettingsPanel /></div>, target) : null
}
