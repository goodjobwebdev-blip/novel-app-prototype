export type UiTypography = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  fontWeight: number
}

export type ThemePalette = {
  background: string
  elevated: string
  editor: string
  text: string
  muted: string
  border: string
  accent: string
  accentActive: string
  selection: string
  error: string
}

export type BuiltInThemeId = 'very-dark' | 'blue-dark' | 'green-dark' | 'very-white' | 'blue-light' | 'green-light'

export type CustomUiTheme = {
  id: string
  name: string
  palette: ThemePalette
}

export type UiSettings = {
  editor: UiTypography
  inputs: UiTypography
  activeThemeId: string
  customThemes: CustomUiTheme[]
}

export type FontOption = {
  family: string
  label: string
  stack: string
  kind: 'serif' | 'sans' | 'mono' | 'system'
  bundled: boolean
}

export type BuiltInTheme = {
  id: BuiltInThemeId
  name: string
  tone: 'dark' | 'light'
  palette: ThemePalette
}

export const UI_SETTINGS_STORAGE_KEY = 'arc.ui.settings.v1'
export const UI_SETTINGS_EVENT = 'arc-ui-settings-changed'

export const fontOptions: FontOption[] = [
  { family: 'Literata', label: 'Literata', stack: '"Literata", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Newsreader', label: 'Newsreader', stack: '"Newsreader", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Lora', label: 'Lora', stack: '"Lora", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Source Serif 4', label: 'Source Serif 4', stack: '"Source Serif 4", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Crimson Pro', label: 'Crimson Pro', stack: '"Crimson Pro", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'EB Garamond', label: 'EB Garamond', stack: '"EB Garamond", Garamond, Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Noto Serif', label: 'Noto Serif', stack: '"Noto Serif", Georgia, serif', kind: 'serif', bundled: true },
  { family: 'Iowan Old Style', label: 'Iowan Old Style', stack: '"Iowan Old Style", Baskerville, Georgia, serif', kind: 'system', bundled: false },
  { family: 'Baskerville', label: 'Baskerville', stack: 'Baskerville, Georgia, serif', kind: 'system', bundled: false },
  { family: 'Georgia', label: 'Georgia', stack: 'Georgia, serif', kind: 'system', bundled: false },
  { family: 'Times New Roman', label: 'Times New Roman', stack: '"Times New Roman", serif', kind: 'system', bundled: false },
  { family: 'Inter', label: 'Inter', stack: 'Inter, ui-sans-serif, system-ui, sans-serif', kind: 'sans', bundled: true },
  { family: 'Roboto', label: 'Roboto', stack: 'Roboto, ui-sans-serif, system-ui, sans-serif', kind: 'sans', bundled: true },
  { family: 'Open Sans', label: 'Open Sans', stack: '"Open Sans", ui-sans-serif, system-ui, sans-serif', kind: 'sans', bundled: true },
  { family: 'DM Sans', label: 'DM Sans', stack: '"DM Sans", ui-sans-serif, system-ui, sans-serif', kind: 'sans', bundled: true },
  { family: 'Manrope', label: 'Manrope', stack: 'Manrope, ui-sans-serif, system-ui, sans-serif', kind: 'sans', bundled: true },
  { family: 'System UI', label: 'System UI', stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', kind: 'system', bundled: false },
  { family: 'Arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', kind: 'system', bundled: false },
  { family: 'Helvetica', label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif', kind: 'system', bundled: false },
  { family: 'JetBrains Mono', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, monospace', kind: 'mono', bundled: true },
  { family: 'Roboto Mono', label: 'Roboto Mono', stack: '"Roboto Mono", ui-monospace, monospace', kind: 'mono', bundled: true },
  { family: 'Source Code Pro', label: 'Source Code Pro', stack: '"Source Code Pro", ui-monospace, monospace', kind: 'mono', bundled: true },
  { family: 'Courier New', label: 'Courier New', stack: '"Courier New", monospace', kind: 'system', bundled: false },
]

export const builtInThemes: BuiltInTheme[] = [
  {
    id: 'very-dark',
    name: 'Very Dark',
    tone: 'dark',
    palette: {
      background: '#090a09', elevated: '#151613', editor: '#10110f', text: '#e9e4d9', muted: '#9e9a91', border: '#30312d',
      accent: '#c6a86b', accentActive: '#e0c88f', selection: '#4a4028', error: '#e18e87',
    },
  },
  {
    id: 'blue-dark',
    name: 'Blue Dark',
    tone: 'dark',
    palette: {
      background: '#091019', elevated: '#121c28', editor: '#0d1621', text: '#e7edf4', muted: '#94a5b7', border: '#26384a',
      accent: '#70a9dc', accentActive: '#a2c9eb', selection: '#244d72', error: '#e08d91',
    },
  },
  {
    id: 'green-dark',
    name: 'Green Dark',
    tone: 'dark',
    palette: {
      background: '#09110d', elevated: '#131e18', editor: '#0e1712', text: '#e7eee9', muted: '#96aa9c', border: '#284033',
      accent: '#82b894', accentActive: '#add2b9', selection: '#285239', error: '#e08d86',
    },
  },
  {
    id: 'very-white',
    name: 'Very White',
    tone: 'light',
    palette: {
      background: '#f7f7f5', elevated: '#ffffff', editor: '#ffffff', text: '#1d1e1b', muted: '#6e716b', border: '#d8dad4',
      accent: '#8a6a2f', accentActive: '#684c18', selection: '#eadfc8', error: '#b84f4f',
    },
  },
  {
    id: 'blue-light',
    name: 'Blue Light',
    tone: 'light',
    palette: {
      background: '#f3f7fb', elevated: '#ffffff', editor: '#fafdff', text: '#172432', muted: '#65778a', border: '#cad8e5',
      accent: '#3978b1', accentActive: '#255f93', selection: '#d6e8f7', error: '#b94f59',
    },
  },
  {
    id: 'green-light',
    name: 'Green Light',
    tone: 'light',
    palette: {
      background: '#f3f8f4', elevated: '#ffffff', editor: '#fbfefb', text: '#18271e', muted: '#65776b', border: '#cadbce',
      accent: '#3f8057', accentActive: '#28633d', selection: '#d9ecdd', error: '#b7504d',
    },
  },
]

export const defaultUiSettings: UiSettings = {
  editor: { fontFamily: 'Literata', fontSize: 19, lineHeight: 1.78, fontWeight: 400 },
  inputs: { fontFamily: 'Inter', fontSize: 15, lineHeight: 1.55, fontWeight: 400 },
  activeThemeId: 'very-dark',
  customThemes: [],
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

function validColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function sanitizeTypography(value: Partial<UiTypography> | undefined, fallback: UiTypography): UiTypography {
  const family = typeof value?.fontFamily === 'string' && fontOptions.some((font) => font.family === value.fontFamily)
    ? value.fontFamily
    : fallback.fontFamily
  return {
    fontFamily: family,
    fontSize: clamp(value?.fontSize, fallback.fontSize, 10, 48),
    lineHeight: clamp(value?.lineHeight, fallback.lineHeight, 1, 2.6),
    fontWeight: clamp(value?.fontWeight, fallback.fontWeight, 100, 900),
  }
}

function sanitizePalette(value: Partial<ThemePalette> | undefined, fallback: ThemePalette): ThemePalette {
  return {
    background: validColor(value?.background, fallback.background),
    elevated: validColor(value?.elevated, fallback.elevated),
    editor: validColor(value?.editor, fallback.editor),
    text: validColor(value?.text, fallback.text),
    muted: validColor(value?.muted, fallback.muted),
    border: validColor(value?.border, fallback.border),
    accent: validColor(value?.accent, fallback.accent),
    accentActive: validColor(value?.accentActive, fallback.accentActive),
    selection: validColor(value?.selection, fallback.selection),
    error: validColor(value?.error, fallback.error),
  }
}

export function resolveTheme(settings: UiSettings) {
  const builtIn = builtInThemes.find((theme) => theme.id === settings.activeThemeId)
  if (builtIn) return { id: builtIn.id, name: builtIn.name, palette: builtIn.palette, custom: false, tone: builtIn.tone as 'dark' | 'light' }
  const custom = settings.customThemes.find((theme) => theme.id === settings.activeThemeId)
  if (custom) return { id: custom.id, name: custom.name, palette: custom.palette, custom: true, tone: getPaletteTone(custom.palette) }
  const fallback = builtInThemes[0]
  return { id: fallback.id, name: fallback.name, palette: fallback.palette, custom: false, tone: fallback.tone as 'dark' | 'light' }
}

function getPaletteTone(palette: ThemePalette): 'dark' | 'light' {
  const hex = palette.background.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? 'light' : 'dark'
}

export function fontStack(family: string) {
  return fontOptions.find((font) => font.family === family)?.stack ?? defaultUiSettings.editor.fontFamily
}

export function loadUiSettings(): UiSettings {
  if (typeof window === 'undefined') return defaultUiSettings
  try {
    const stored = JSON.parse(window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY) ?? 'null') as Partial<UiSettings> | null
    if (!stored) return defaultUiSettings
    const fallbackPalette = builtInThemes[0].palette
    const customThemes = Array.isArray(stored.customThemes)
      ? stored.customThemes.flatMap((theme) => {
          if (!theme || typeof theme !== 'object') return []
          const candidate = theme as Partial<CustomUiTheme>
          if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return []
          return [{ id: candidate.id, name: candidate.name.slice(0, 80) || 'Custom theme', palette: sanitizePalette(candidate.palette, fallbackPalette) }]
        })
      : []
    const activeThemeId = typeof stored.activeThemeId === 'string' && (builtInThemes.some((theme) => theme.id === stored.activeThemeId) || customThemes.some((theme) => theme.id === stored.activeThemeId))
      ? stored.activeThemeId
      : defaultUiSettings.activeThemeId
    return {
      editor: sanitizeTypography(stored.editor, defaultUiSettings.editor),
      inputs: sanitizeTypography(stored.inputs, defaultUiSettings.inputs),
      activeThemeId,
      customThemes,
    }
  } catch {
    return defaultUiSettings
  }
}

export function saveUiSettings(settings: UiSettings) {
  const next: UiSettings = {
    editor: sanitizeTypography(settings.editor, defaultUiSettings.editor),
    inputs: sanitizeTypography(settings.inputs, defaultUiSettings.inputs),
    activeThemeId: settings.activeThemeId,
    customThemes: settings.customThemes.map((theme) => ({ ...theme, name: theme.name.slice(0, 80), palette: sanitizePalette(theme.palette, builtInThemes[0].palette) })),
  }
  window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(next))
  applyUiSettings(next)
  window.dispatchEvent(new CustomEvent<UiSettings>(UI_SETTINGS_EVENT, { detail: next }))
  return next
}

export function applyUiSettings(settings: UiSettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const theme = resolveTheme(settings)
  const palette = theme.palette

  root.dataset.uiTheme = theme.id
  root.dataset.uiThemeTone = theme.tone
  root.style.setProperty('--canvas', palette.background)
  root.style.setProperty('--deep', palette.background)
  root.style.setProperty('--surface', palette.elevated)
  root.style.setProperty('--surface-2', palette.editor)
  root.style.setProperty('--editor-surface', palette.editor)
  root.style.setProperty('--ink', palette.text)
  root.style.setProperty('--soft', palette.muted)
  root.style.setProperty('--faint', palette.muted)
  root.style.setProperty('--line', palette.border)
  root.style.setProperty('--accent', palette.accent)
  root.style.setProperty('--accent-bright', palette.accentActive)
  root.style.setProperty('--selection', palette.selection)
  root.style.setProperty('--danger', palette.error)

  root.style.setProperty('--editor-font-family', fontStack(settings.editor.fontFamily))
  root.style.setProperty('--editor-font-size', `${settings.editor.fontSize}px`)
  root.style.setProperty('--editor-line-height', String(settings.editor.lineHeight))
  root.style.setProperty('--editor-font-weight', String(settings.editor.fontWeight))
  root.style.setProperty('--input-font-family', fontStack(settings.inputs.fontFamily))
  root.style.setProperty('--input-font-size', `${settings.inputs.fontSize}px`)
  root.style.setProperty('--input-line-height', String(settings.inputs.lineHeight))
  root.style.setProperty('--input-font-weight', String(settings.inputs.fontWeight))
}

export function applyStoredUiSettings() {
  const settings = loadUiSettings()
  applyUiSettings(settings)
  return settings
}

export function createCustomTheme(settings: UiSettings, sourceThemeId = settings.activeThemeId): UiSettings {
  const source = resolveTheme({ ...settings, activeThemeId: sourceThemeId })
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `custom-${crypto.randomUUID()}` : `custom-${Date.now()}`
  const theme: CustomUiTheme = { id, name: `Custom ${source.name}`, palette: { ...source.palette } }
  return saveUiSettings({ ...settings, activeThemeId: id, customThemes: [...settings.customThemes, theme] })
}
