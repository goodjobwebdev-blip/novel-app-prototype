import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Copy, Palette, Plus, Search, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  UI_SETTINGS_EVENT,
  defaultUiSettings,
  applyUiSettings,
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

import { contrastWarnings } from './appearance-utils'
import SettingsSectionTabs from './SettingsSectionTabs'

// Preserve failed saves and unapplied palette edits when the settings portal remounts.
let pendingSettings: UiSettings | null = null
let pendingTheme: CustomUiTheme | null = null

type TypographyKey = keyof UiTypography

function RangeSetting({ label, value, min, max, step, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  const id = useId()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const applyNumber = () => { const number = Number(text); const next = text.trim() && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : value; setText(String(next)); onChange(next) }
  return <div className="ui-range-setting"><label htmlFor={id}><strong>{label}</strong></label><div className="ui-range-number"><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><input type="number" aria-label={`${label} exact value`} min={min} max={max} step={step} value={text} onChange={event => setText(event.target.value)} onBlur={applyNumber} onKeyDown={event => { if (event.key === 'Enter') applyNumber() }} /><span>{suffix}</span></div></div>
}

function FontPicker({ label, value, onChange }: { label: string; value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const pickerId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closePicker = () => { setOpen(false); triggerRef.current?.focus() }
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
    <span id={`${pickerId}-label`}>{label}</span>
    <button ref={triggerRef} aria-labelledby={`${pickerId}-label ${pickerId}-value`} aria-haspopup="listbox" aria-controls={`${pickerId}-list`} className="ui-font-picker-trigger" type="button" onClick={() => { setOpen((value) => !value); setQuery(''); setActiveIndex(Math.max(0, fontOptions.findIndex(font => font.family === value))) }} aria-expanded={open}>
      <span id={`${pickerId}-value`} style={{ fontFamily: current.stack }}>{current.label}</span>
      <small>{current.bundled ? 'Bundled' : 'System'}</small>
    </button>
    {open && <div className="ui-font-picker-popover" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); closePicker() }
        if (event.key === 'Tab') setOpen(false)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const index = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % Math.max(1, visible.length); setActiveIndex(index); document.getElementById(`${pickerId}-option-${index}`)?.scrollIntoView({ block: 'nearest' }) }
        if (event.key === 'Enter' && visible[activeIndex]) { event.preventDefault(); onChange(visible[activeIndex].family); closePicker() }
      }}>
      <label className="ui-font-search"><Search aria-hidden="true" /><input autoFocus role="combobox" aria-label="Search fonts" aria-expanded="true" aria-controls={`${pickerId}-list`} aria-activedescendant={visible[activeIndex] ? `${pickerId}-option-${activeIndex}` : undefined} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="Search fonts" /></label>
      <div id={`${pickerId}-list`} className="ui-font-list" role="listbox" aria-label={label}>
        {visible.map((font, index) => <button id={`${pickerId}-option-${index}`} tabIndex={-1} data-active={activeIndex === index} key={font.family} className={font.family === value ? 'selected' : ''} type="button" role="option" aria-selected={font.family === value} onClick={() => { onChange(font.family); closePicker() }}>
          <span style={{ fontFamily: font.stack }}>{font.label}</span><small>{font.kind}{font.bundled ? ' · offline' : ' · system'}</small>{font.family === value && <Check aria-hidden="true" />}
        </button>)}
        {!visible.length && <p>No matching fonts.</p>}
      </div>
    </div>}
  </div>
}

function TypographySection({ number, title, description, value, onChange, onReset }: { number: string; title: string; description: string; value: UiTypography; onChange: (value: UiTypography) => void; onReset: () => void }) {
  const update = (key: TypographyKey, next: string | number) => onChange({ ...value, [key]: next })
  return <section className="settings-card ui-typography-card">
    <div className="card-heading"><div><span>{number}</span><h2>{title}</h2></div><p>{description}</p></div>
    <FontPicker label="Font family" value={value.fontFamily} onChange={(family) => update('fontFamily', family)} />
    <div className="ui-range-grid">
      <RangeSetting label="Font size" value={value.fontSize} min={10} max={48} step={1} suffix=" px" onChange={(next) => update('fontSize', next)} />
      <RangeSetting label="Line height" value={value.lineHeight} min={1} max={2.6} step={0.05} onChange={(next) => update('lineHeight', next)} />
      <RangeSetting label="Font weight" value={value.fontWeight} min={100} max={900} step={50} onChange={(next) => update('fontWeight', next)} />
    </div>
    <div className="ui-type-preview" style={{ fontFamily: fontStack(value.fontFamily), fontSize: value.fontSize, lineHeight: value.lineHeight, fontWeight: value.fontWeight }}>
      {number === '01' ? <><p>The quiet room held its breath while the next sentence arrived. Outside, the rain traced silver lines down the window.</p><p>“Tell me what happened,” she said.</p></> : <><small>Writing instruction</small><p>Continue the scene from Mara’s point of view. Keep the dialogue restrained and leave the letter unopened.</p></>}
    </div><button className="ui-secondary-action" type="button" onClick={onReset}>Reset {number === '01' ? 'editor' : 'input'} typography</button>
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
    <button className="ui-theme-select" aria-pressed={active} type="button" onClick={onSelect}>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  const valid = /^#[0-9a-f]{6}$/i.test(hex)
  return <div className="ui-color-field"><span>{label}</span><div><input type="color" aria-label={`${label} color`} value={value} onChange={event => onChange(event.target.value)} /><input type="text" aria-label={`${label} hex`} value={hex} spellCheck={false} aria-invalid={!valid} onChange={event => { setHex(event.target.value); if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value) }} onBlur={() => { if (!valid) setHex(value) }} /></div>{!valid && <small>Enter # followed by six hexadecimal digits.</small>}</div>
}

function ThemeEditor({ theme, onChange, onApply, onCancel }: { theme: CustomUiTheme; onChange: (theme: CustomUiTheme) => void; onApply: () => void; onCancel: () => void }) {
  const warnings = contrastWarnings(theme.palette)
  return <section className="ui-theme-editor"><header><div><Palette aria-hidden="true" /><span><strong>Customize theme</strong><small>Draft changes affect only the preview until you apply them.</small></span></div></header>
    <label className="ui-theme-name"><span>Theme name</span><input value={theme.name} maxLength={80} onChange={event => onChange({ ...theme, name: event.target.value })} /></label>
    {([['Surfaces', ['background', 'elevated', 'editor', 'border']], ['Text', ['text', 'muted']], ['Accents', ['accent', 'accentActive', 'selection', 'error']]] as const).map(([group, keys]) => <fieldset className="ui-color-group" key={group}><legend>{group}</legend><div className="ui-color-grid">{keys.map(key => <ColorField key={key} label={colorLabels.find(item => item[0] === key)![1]} value={theme.palette[key]} onChange={value => onChange({ ...theme, palette: { ...theme.palette, [key]: value } })} />)}</div></fieldset>)}
    {warnings.length > 0 && <div className="ui-contrast-warning" role="status"><strong>Some colors may be difficult to read</strong><ul>{warnings.map(item => <li key={item.label}>{item.label}: {item.ratio.toFixed(2)}:1 contrast. Try a lighter or darker color.</li>)}</ul></div>}
    <div className="ui-theme-preview" style={{ background: theme.palette.background, borderColor: theme.palette.border, color: theme.palette.text }}><aside style={{ background: theme.palette.elevated, borderColor: theme.palette.border }}><i style={{ background: theme.palette.accent }} /><span style={{ color: theme.palette.muted }}>Outline</span></aside><article style={{ background: theme.palette.editor }}><small style={{ color: theme.palette.accent }}>SCENE 07</small><p>Theme preview for the writing surface.</p><mark style={{ background: theme.palette.selection, color: theme.palette.text }}>Selected text</mark></article></div>
    <div className="ui-draft-actions"><button type="button" onClick={onApply} disabled={!theme.name.trim()}>Apply theme</button><button type="button" onClick={onCancel}>Cancel changes</button></div>
  </section>
}

const appearanceSections = [['theme', 'Theme'], ['typography', 'Typography'], ['customization', 'Customization']] as const

function UiSettingsPanel() {
  const [settings, setSettings] = useState<UiSettings>(() => pendingSettings ?? loadUiSettings())
  const [section, setSection] = useState<'theme' | 'typography' | 'customization'>('theme')
  const [saveError, setSaveError] = useState(Boolean(pendingSettings))
  const [draft, setDraft] = useState<CustomUiTheme | null>(pendingTheme)
  const [deleted, setDeleted] = useState<{ theme: CustomUiTheme; wasActive: boolean } | null>(null)
  const lastBuiltIn = useRef(builtInThemes.some(theme => theme.id === settings.activeThemeId) ? settings.activeThemeId : 'very-dark')
  const editDraft = (theme: CustomUiTheme | null) => { pendingTheme = theme; setDraft(theme) }
  const activeTheme = resolveTheme(settings)
  const activeCustom = settings.customThemes.find((theme) => theme.id === settings.activeThemeId)

  useEffect(() => {
    const sync = (event: Event) => { if (!pendingSettings) setSettings((event as CustomEvent<UiSettings>).detail ?? loadUiSettings()) }
    window.addEventListener(UI_SETTINGS_EVENT, sync)
    return () => window.removeEventListener(UI_SETTINGS_EVENT, sync)
  }, [])

  function persist(next: UiSettings) {
    pendingSettings = next
    setSettings(next)
    try { const saved = saveUiSettings(next); pendingSettings = null; setSettings(saved); setSaveError(false) } catch { setSaveError(true) }
  }
  function commit(transform: (current: UiSettings) => UiSettings) { persist(transform(pendingSettings ?? settings)) }
  function duplicate(themeId: string) {
    if (draft && !window.confirm('Discard the current theme draft and create another?')) return
    const next = createCustomTheme(settings, themeId)
    editDraft(next.customThemes[next.customThemes.length - 1])
    setSection('customization')
  }
  function beginEdit(theme: CustomUiTheme) {
    if (draft && draft.id !== theme.id && !window.confirm('Discard the current theme draft?')) return
    editDraft({ ...theme, palette: { ...theme.palette } })
    setSection('customization')
  }
  function applyDraft() {
    if (!draft) return
    commit(current => ({ ...current, activeThemeId: draft.id, customThemes: [...current.customThemes.filter(theme => theme.id !== draft.id), { ...draft, name: draft.name.trim() }] }))
    editDraft(null)
  }
  function selectTheme(id: string) {
    if (builtInThemes.some(theme => theme.id === id)) lastBuiltIn.current = id
    commit(current => ({ ...current, activeThemeId: id }))
  }
  function resetTheme() { editDraft(null); selectTheme('very-dark'); applyUiSettings({ ...(pendingSettings ?? settings), activeThemeId: 'very-dark' }) }

  function removeCustomTheme(theme: CustomUiTheme) {
    if (!window.confirm(`Delete “${theme.name}”?`)) return
    setDeleted({ theme, wasActive: settings.activeThemeId === theme.id })
    if (draft?.id === theme.id) editDraft(null)
    commit((current) => ({
      ...current,
      activeThemeId: current.activeThemeId === theme.id ? lastBuiltIn.current : current.activeThemeId,
      customThemes: current.customThemes.filter((item) => item.id !== theme.id),
    }))
  }

  return <section className="ui-settings-panel" aria-labelledby="page-title">
    <header className="page-heading"><div><p>Global UI</p><h1 id="page-title">Appearance</h1><span>Applies to every book on this device. UI settings are global and cannot be overridden by a book.</span></div><div className={`save-state ${saveError ? 'error' : 'saved'}`} role="status" aria-live="polite"><i />{saveError ? 'Not saved' : 'Saved'}{saveError && <button type="button" onClick={() => persist(pendingSettings ?? settings)}>Retry</button>}</div></header>

    {saveError && <p className="ui-save-error" role="alert">Changes could not be saved on this device. They are kept here for retry; a reload will use the last saved appearance.</p>}
    <div className="ui-appearance-tools"><span className="ui-scope-summary">All books on this device · {saveError ? 'Not saved' : 'Saved automatically'}</span><button type="button" className="ui-safe-reset" onClick={resetTheme}>Reset to readable theme</button></div>
    <SettingsSectionTabs tabs={appearanceSections.map(([tab, label]) => [tab, tab === 'customization' && draft ? `${label} · Draft` : label] as const)} active={section} onChange={setSection} idPrefix="appearance" label="Appearance sections" />
    <div hidden={section !== 'typography'} role="tabpanel" id="appearance-panel-typography" aria-labelledby="appearance-tab-typography">
    <TypographySection onReset={() => commit(current => ({ ...current, editor: { ...defaultUiSettings.editor } }))} number="01" title="Main editor" description="Typography for Scenes, Notes, Codex entries, and summaries." value={settings.editor} onChange={(editor) => commit((current) => ({ ...current, editor }))} />
    <TypographySection onReset={() => commit(current => ({ ...current, inputs: { ...defaultUiSettings.inputs } }))} number="02" title="Expandable inputs" description="Typography for scalable drawer and chat/context text inputs." value={settings.inputs} onChange={(inputs) => commit((current) => ({ ...current, inputs }))} />

    </div><section hidden={section !== 'theme'} className="settings-card ui-themes-card" role="tabpanel" id="appearance-panel-theme" aria-labelledby="appearance-tab-theme">
      <div className="card-heading"><div><span>03</span><h2>Themes</h2></div><p>Typography stays independent when the theme changes.</p></div>
      <div className="ui-theme-group"><h3>Built in</h3><div className="ui-theme-grid">
        {builtInThemes.map((theme) => <ThemeOption key={theme.id} id={theme.id} name={theme.name} palette={theme.palette} active={settings.activeThemeId === theme.id} onSelect={() => selectTheme(theme.id)} onDuplicate={() => duplicate(theme.id)} />)}
      </div></div>

      <div className="ui-theme-group ui-custom-themes"><header><h3>Custom</h3><button className="create-theme" type="button" onClick={() => duplicate(activeTheme.id)}><Plus aria-hidden="true" /> Create theme</button></header>
        {settings.customThemes.length ? <div className="ui-theme-grid">{settings.customThemes.map((theme) => <ThemeOption key={theme.id} id={theme.id} name={theme.name} palette={theme.palette} active={settings.activeThemeId === theme.id} custom onSelect={() => selectTheme(theme.id)} onDuplicate={() => duplicate(theme.id)} onDelete={() => removeCustomTheme(theme)} />)}</div> : <p className="ui-custom-empty">Create a theme from the active palette, or duplicate any built-in theme to customize it.</p>}
      </div>

    </section>
    {deleted && <div className="ui-delete-notice" role="status">Deleted “{deleted.theme.name}”<button type="button" onClick={() => { commit(current => ({ ...current, customThemes: [...current.customThemes.filter(theme => theme.id !== deleted.theme.id), deleted.theme], activeThemeId: deleted.wasActive ? deleted.theme.id : current.activeThemeId })); setDeleted(null) }}>Undo</button></div>}
    <section hidden={section !== 'customization'} className="settings-card ui-customization-card" role="tabpanel" id="appearance-panel-customization" aria-labelledby="appearance-tab-customization"><h2>Customization</h2>{draft ? <ThemeEditor key={draft.id} theme={draft} onChange={editDraft} onApply={applyDraft} onCancel={() => editDraft(null)} /> : <><p>Edit a copy of a built-in palette, or customize the active custom theme.</p>{activeCustom && <button type="button" onClick={() => beginEdit(activeCustom)}>Edit {activeCustom.name}</button>}<button type="button" onClick={() => duplicate(activeTheme.id)}>Create from {activeTheme.name}</button></>}</section>
  </section>
}

export default function UiSettingsPortalBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    let railFooter: HTMLParagraphElement | null = null
    let originalRailText = ''

    function restoreRailFooter() {
      if (railFooter) railFooter.textContent = originalRailText
      railFooter = null
      originalRailText = ''
    }

    function findTarget() {
      const next = document.querySelector<HTMLElement>('.appearance-settings')
      if (next === current) return
      if (current) current.classList.remove('ui-settings-enhanced')
      restoreRailFooter()
      current = next
      if (current) {
        current.classList.add('ui-settings-enhanced')
        railFooter = current.closest('.app-shell')?.querySelector<HTMLParagraphElement>('.settings-rail > p') ?? null
        if (railFooter) {
          originalRailText = railFooter.textContent ?? ''
          railFooter.textContent = 'UI settings are global on this device and apply to every book. Books cannot override them.'
        }
      }
      setTarget(current)
    }

    findTarget()
    const observer = new MutationObserver(findTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (current) current.classList.remove('ui-settings-enhanced')
      restoreRailFooter()
    }
  }, [])

  return target ? createPortal(<div className="ui-settings-portal"><UiSettingsPanel /></div>, target) : null
}
