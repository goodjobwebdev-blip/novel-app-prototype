import { initialAiSettings, loadAiSettings, normalizeAiSettings, type AiSettings, type SpeechSettings } from '../../shared/ai/ai-settings'
import { clonePromptComposition, legacyPromptMirror, type PromptComposition, type PromptCompositionScope } from '../../shared/ai/prompt-composition'
import { builtInThemes, fontOptions, loadUiSettings, type UiSettings } from './ui-settings'
import { loadImageSettings, validateImageSettings } from '../images/image-settings'
import { modelTasks, type ImageSettings } from '../images/image-generation-types'
import { loadUserPromptPresets } from './prompt-presets'
import { THINKING_EFFORT_OPTIONS } from '../../shared/ai/thinking-effort'

export type ProfileKind = 'text'|'tts'|'stt'|'image'|'video'|'ui'|'story'|'codex'|'summary'|'chat'|'character'
export type SettingsProfile = { id: string; name: string; kind: ProfileKind; settings: AiSettings; ui?: UiSettings; media?: Omit<ImageSettings, 'keys'> }
export type BookProfileSelections = Record<'text'|'tts'|'stt'|'image'|'video'|'ui'|'story'|'codex'|'summary', string>
export type SettingsProfileLibrary = { version: 1; profiles: SettingsProfile[]; defaults: Record<ProfileKind, string> }
export const SETTINGS_PROFILES_EVENT = 'arc-settings-profiles-changed'
export const SETTINGS_PROFILES_STORAGE_KEY = 'arc.settings.profiles.v1'
export const PROFILE_KINDS: ProfileKind[] = ['text', 'tts', 'stt', 'image', 'video', 'ui', 'story', 'codex', 'summary', 'chat', 'character']
export const BOOK_PROFILE_KINDS: Array<keyof BookProfileSelections> = ['text', 'tts', 'stt', 'image', 'video', 'ui', 'story', 'codex', 'summary']
export const PROFILE_PROMPT_SCOPES: Partial<Record<ProfileKind, PromptCompositionScope>> = { story: 'story', codex: 'lore', summary: 'summarize', chat: 'assistant', character: 'assistant' }
const characterComposition: PromptComposition = { systemPrompt: 'Roleplay the selected characters at the supplied story position. Stay in character, distinguish uncertainty, and write dialogue naturally. Use only the selected speaker labels.', predefinedMessages: [{ id: 'character-context', name: 'Story context', role: 'system', enabled: true, template: '{{context.automatic}}' }, { id: 'character-additional', name: 'Selected references', role: 'system', enabled: true, template: '{{context.additional}}' }] }
const emptyKeys: ImageSettings['keys'] = { nanogpt: '', openai: '', pruna: '' }
// Server-side/test imports have no browser storage. Do not mask browser storage failures.
let serverLibrary: string | null = null
function readStoredLibrary() { return typeof localStorage === 'undefined' && typeof window === 'undefined' ? serverLibrary : localStorage.getItem(SETTINGS_PROFILES_STORAGE_KEY) }
function storeLibrary(value: string) {
  if (typeof localStorage === 'undefined' && typeof window === 'undefined') serverLibrary = value
  else localStorage.setItem(SETTINGS_PROFILES_STORAGE_KEY, value)
}
const optionalAiKeys = ['mainModelContextLength', 'supportModelContextLength', 'codexModelContextLength', 'chatModelContextLength', 'characterModelContextLength', 'chatPromptPresetId', 'characterPromptPresetId']

/** Explicit runtime-shape allowlist: credentials are absent, not merely blank, on disk. */
export function sanitizeProfileSettings(value: Partial<AiSettings>): AiSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile settings.')
  const allowed = Object.fromEntries([...Object.keys(initialAiSettings), ...optionalAiKeys, 'responseLength'].filter(key => !['apiKey', 'baseUrl', 'providerProfiles'].includes(key) && value[key as keyof AiSettings] !== undefined).map(key => [key, value[key as keyof AiSettings]]))
  const settings = normalizeAiSettings(allowed)
  const { apiKey: _key, baseUrl: _url, providerProfiles: _connections, ...safe } = settings
  const { apiKey: _speechKey, openaiApiKey: _sttKey, ...speech } = settings.speech
  safe.favorites = []
  for (const key of ['mainModel', 'supportModel', 'codexModel'] as const) if (typeof safe[key] !== 'string') throw new Error('Invalid profile model identifier.')
  // normalizeAiSettings deliberately accepts unknown legacy fields; never carry those across this boundary.
  return { ...Object.fromEntries([...Object.keys(initialAiSettings), ...optionalAiKeys].filter(key => !['apiKey', 'baseUrl', 'providerProfiles', 'speech'].includes(key)).map(key => [key, safe[key as keyof typeof safe]])), speech } as AiSettings
}

function sanitizeMedia(value: Omit<ImageSettings, 'keys'>): Omit<ImageSettings, 'keys'> {
  if (!Array.isArray(value.favorites)) throw new Error('Invalid media profile.')
  for (const favorite of value.favorites) {
    if (typeof favorite.name !== 'string' || typeof favorite.source !== 'string' || (favorite.description !== undefined && typeof favorite.description !== 'string')) throw new Error('Invalid media model metadata.')
    for (const key of ['videoResolutions', 'aspectRatios'] as const) if (favorite[key] !== undefined && (!Array.isArray(favorite[key]) || !favorite[key]!.every(item => typeof item === 'string'))) throw new Error('Invalid media model options.')
    if (favorite.videoDurations !== undefined && (!Array.isArray(favorite.videoDurations) || !favorite.videoDurations.every(Number.isFinite))) throw new Error('Invalid video durations.')
    if (favorite.cost !== undefined && !Number.isFinite(favorite.cost)) throw new Error('Invalid media model cost.')
  }
  const favoriteKeys = ['id', 'name', 'provider', 'sizes', 'source', 'cost', 'description', 'tasks', 'maxSourceImages', 'videoResolutions', 'videoDurations', 'aspectRatios', 'quality', 'moderation', 'alias', 'enabledSizes', 'defaultSize']
  const favorites = value.favorites.map(favorite => Object.fromEntries(favoriteKeys.filter(key => key in favorite).map(key => [key, favorite[key as keyof typeof favorite]]))) as ImageSettings['favorites']
  const { keys: _keys, ...media } = validateImageSettings({ keys: emptyKeys, favorites, defaultAlias: value.defaultAlias, defaultAliases: value.defaultAliases })
  return media
}

function sanitizeUi(ui: UiSettings): UiSettings {
  if (!ui || !ui.editor || !ui.inputs || !Array.isArray(ui.customThemes) || typeof ui.activeThemeId !== 'string') throw new Error('Invalid UI profile.')
  const typography = (value: UiSettings['editor']) => {
    if (!value || !fontOptions.some(font => font.family === value.fontFamily) || ![value.fontSize, value.lineHeight, value.fontWeight].every(Number.isFinite) || value.fontSize < 10 || value.fontSize > 48 || value.lineHeight < 1 || value.lineHeight > 2.6 || value.fontWeight < 100 || value.fontWeight > 900) throw new Error('Invalid profile typography.')
    return { fontFamily: value.fontFamily, fontSize: value.fontSize, lineHeight: value.lineHeight, fontWeight: value.fontWeight }
  }
  const colors = ['background', 'elevated', 'editor', 'text', 'muted', 'border', 'accent', 'accentActive', 'selection', 'error'] as const
  const themeIds = new Set(builtInThemes.map(theme => String(theme.id)))
  for (const theme of ui.customThemes) {
    if (!theme || typeof theme.id !== 'string' || !theme.id.trim() || themeIds.has(theme.id) || typeof theme.name !== 'string' || !theme.name.trim() || !theme.palette || !colors.every(key => typeof theme.palette[key] === 'string' && /^#[0-9a-f]{6}$/i.test(theme.palette[key]))) throw new Error('Invalid or duplicate custom theme.')
    themeIds.add(theme.id)
  }
  if (!themeIds.has(ui.activeThemeId)) throw new Error('The selected UI theme is unavailable.')
  for (const flag of ['highlightDialogue', 'sceneBeats', 'saveArcAsBeat'] as const) if (ui[flag] !== undefined && typeof ui[flag] !== 'boolean') throw new Error('Invalid UI profile option.')
  return { highlightDialogue: ui.highlightDialogue === true, sceneBeats: ui.sceneBeats !== false, saveArcAsBeat: ui.saveArcAsBeat ?? (ui.sceneBeats !== false), editor: typography(ui.editor), inputs: typography(ui.inputs), activeThemeId: ui.activeThemeId, customThemes: ui.customThemes.map(theme => ({ id: theme.id, name: theme.name, palette: Object.fromEntries(colors.map(key => [key, theme.palette[key]])) as typeof theme.palette })) }
}

export function sanitizeSettingsProfile(profile: SettingsProfile): SettingsProfile {
  if (!profile || typeof profile.id !== 'string' || !profile.id.trim() || typeof profile.name !== 'string' || !profile.name.trim() || !PROFILE_KINDS.includes(profile.kind) || !profile.settings || typeof profile.settings !== 'object') throw new Error('Invalid settings profile.')
  const raw = profile.settings
  if (!['openrouter', 'nanogpt', 'openai', 'litellm', 'compatible', 'fake'].includes(raw.provider)) throw new Error('Invalid profile provider identity.')
  for (const key of ['chatMaxModelRounds', 'characterMaxModelRounds'] as const) if (!Number.isInteger(raw[key]) || raw[key] < 1 || raw[key] > 32) throw new Error('Profile model rounds must be an integer from 1 to 32.')
  for (const key of ['mainModel', 'supportModel', 'codexModel', 'chatModel', 'characterModel', 'mainEffectiveContextLimit', 'codexEffectiveContextLimit', 'generationWordDelayMs'] as const) if (typeof raw[key] !== 'string') throw new Error(`Invalid profile field: ${key}.`)
  for (const key of ['mainThinkingEffort', 'supportThinkingEffort', 'codexThinkingEffort', 'chatThinkingEffort', 'characterThinkingEffort'] as const) if (!THINKING_EFFORT_OPTIONS.some(option => option.value === raw[key])) throw new Error(`Invalid profile field: ${key}.`)
  for (const key of ['mainModelContextLength', 'supportModelContextLength', 'codexModelContextLength', 'chatModelContextLength', 'characterModelContextLength'] as const) if (raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || raw[key]! <= 0)) throw new Error('Model context length must be a positive integer.')
  for (const key of ['mainEffectiveContextLimit', 'codexEffectiveContextLimit'] as const) {
    const cap = raw[key].trim().toLowerCase()
    if (!cap) continue
    const match = /^(\d+(?:\.\d+)?)\s*([km])?$/.exec(cap)
    const tokens = match ? Math.floor(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1)) : NaN
    if (!Number.isSafeInteger(tokens) || tokens < 4096) throw new Error('Context cap must be at least 4,096 tokens, such as 32k or 1m.')
  }
  if (!/^\d+$/.test(raw.generationWordDelayMs) || Number(raw.generationWordDelayMs) < 1 || Number(raw.generationWordDelayMs) > 2000) throw new Error('Reveal speed must be 1–2000 milliseconds per word.')
  for (const key of ['chatPromptPresetId', 'characterPromptPresetId'] as const) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !raw[key]!.trim())) throw new Error('Invalid role prompt preset ID.')
  for (const scope of ['story', 'lore', 'summarize', 'assistant'] as const) {
    const composition = raw.promptCompositions?.[scope]
    if (!composition || typeof composition.systemPrompt !== 'string' || !Array.isArray(composition.predefinedMessages) || !composition.predefinedMessages.every(message => message && typeof message.id === 'string' && ['system', 'user', 'assistant'].includes(message.role) && typeof message.enabled === 'boolean' && typeof message.template === 'string' && (message.name === undefined || typeof message.name === 'string'))) throw new Error(`Invalid ${scope} prompt composition.`)
  }
  if (!raw.responseLengths || !['story', 'codex', 'summary'].every(key => typeof raw.responseLengths[key as keyof AiSettings['responseLengths']] === 'string')) throw new Error('Invalid profile response lengths.')
  if (!raw.speech || !['model', 'voice', 'maxParallelRequests', 'transcriptionModel', 'transcriptionLanguage'].every(key => typeof raw.speech[key as keyof AiSettings['speech']] === 'string')) throw new Error('Invalid speech profile settings.')
  if (!/^\d+$/.test(raw.speech.maxParallelRequests) || Number(raw.speech.maxParallelRequests) < 1 || Number(raw.speech.maxParallelRequests) > 8 || typeof raw.speech.readAloudAfterGeneration !== 'boolean' || typeof raw.speech.streamTranscription !== 'boolean') throw new Error('Invalid speech profile options.')
  if (profile.kind === 'ui' && !profile.ui) throw new Error('A UI profile needs UI settings.')
  if ((profile.kind === 'image' || profile.kind === 'video') && !profile.media) throw new Error('A media profile needs media settings.')
  const settings = sanitizeProfileSettings(raw)
  if (profile.kind === 'text') {
    // Profile connection identity is never a routing decision.
    settings.provider = initialAiSettings.provider
  } else {
    delete settings.chatPromptPresetId
    delete settings.characterPromptPresetId
  }
  const media = profile.media ? sanitizeMedia(profile.media) : undefined
  if ((profile.kind === 'image' || profile.kind === 'video') && media?.favorites.some(model => !modelTasks(model).some(task => task.endsWith(profile.kind)))) throw new Error(`Every ${profile.kind} favorite must support a ${profile.kind} task.`)
  return { id: profile.id, name: profile.name.trim(), kind: profile.kind, settings, ...(profile.ui ? { ui: sanitizeUi(profile.ui) } : {}), ...(media ? { media } : {}) }
}

function findProfile(library: SettingsProfileLibrary, id: string, kind: ProfileKind): SettingsProfile {
  const profile = library.profiles.find(profile => profile.id === id && profile.kind === kind)
  if (!profile) throw new Error(`The selected ${kind} profile is unavailable. Choose an existing profile in Settings.`)
  return profile
}
function validateLibrary(library: SettingsProfileLibrary): SettingsProfileLibrary {
  if (library?.version !== 1 || !Array.isArray(library.profiles) || !library.defaults) throw new Error('Invalid settings profile library. Original data was not changed.')
  const profiles = library.profiles.map(sanitizeSettingsProfile)
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Settings profile IDs must be unique.')
  const clean: SettingsProfileLibrary = { version: 1, profiles, defaults: Object.fromEntries(PROFILE_KINDS.map(kind => [kind, library.defaults[kind]])) as Record<ProfileKind, string> }
  for (const kind of PROFILE_KINDS) findProfile(clean, clean.defaults[kind], kind)
  for (const profile of profiles.filter(profile => profile.kind === 'text')) {
    if (profile.settings.chatPromptPresetId) findProfile(clean, profile.settings.chatPromptPresetId, 'chat')
    if (profile.settings.characterPromptPresetId) findProfile(clean, profile.settings.characterPromptPresetId, 'character')
  }
  return clean
}
function emit(detail?: unknown) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SETTINGS_PROFILES_EVENT, { detail })) }
export function notifySettingsProfilesChanged(bookId: string) { emit({ bookId }) }
function writeLibrary(library: SettingsProfileLibrary): SettingsProfileLibrary {
  const clean = validateLibrary(library)
  storeLibrary(JSON.stringify(clean))
  emit()
  return clean
}

export function loadSettingsProfiles(): SettingsProfileLibrary {
  const stored = readStoredLibrary()
  if (stored !== null) {
    try { return validateLibrary(JSON.parse(stored)) } catch (error) { throw new Error(`Settings profiles could not be loaded; saved data was preserved. ${error instanceof Error ? error.message : ''}`) }
  }
  const ai = initializeLegacyCharacterRole(loadAiSettings()), ui = loadUiSettings(), images = loadImageSettings()
  const defaults = Object.fromEntries(PROFILE_KINDS.map(kind => [kind, `profile-default-${kind}`])) as Record<ProfileKind, string>
  const profiles = PROFILE_KINDS.map(kind => {
    const settings = sanitizeProfileSettings(ai)
    if (kind === 'text') { settings.chatPromptPresetId = defaults.chat; settings.characterPromptPresetId = defaults.character }
    if (kind === 'character') settings.promptCompositions.assistant = clonePromptComposition(characterComposition)
    const media = kind === 'image' || kind === 'video' ? sanitizeMedia({ ...images, favorites: images.favorites.filter(model => modelTasks(model).some(task => task.endsWith(kind))) }) : undefined
    return sanitizeSettingsProfile({ id: defaults[kind], name: `Default ${kind}`, kind, settings, ...(kind === 'ui' ? { ui } : {}), ...(media ? { media } : {}) })
  })
  for (const preset of loadUserPromptPresets()) {
    const kind = preset.scope as ProfileKind, scope = PROFILE_PROMPT_SCOPES[kind]
    if (!scope || profiles.some(profile => profile.id === preset.id)) continue
    const settings = sanitizeProfileSettings(ai)
    settings.promptCompositions[scope] = { systemPrompt: preset.systemPrompt, predefinedMessages: preset.predefinedMessages.map((message, index) => ({ ...message, id: `${preset.id}-${index}` })) }
    profiles.push(sanitizeSettingsProfile({ id: preset.id, name: preset.name, kind, settings }))
  }
  return writeLibrary({ version: 1, profiles, defaults })
}

export function defaultBookProfileSelections(): BookProfileSelections {
  const { defaults } = loadSettingsProfiles()
  return Object.fromEntries(BOOK_PROFILE_KINDS.map(kind => [kind, defaults[kind]])) as BookProfileSelections
}
export function validateBookProfileSelections(value: BookProfileSelections, library = loadSettingsProfiles()): BookProfileSelections {
  const result = {} as BookProfileSelections
  for (const kind of BOOK_PROFILE_KINDS) { findProfile(library, value?.[kind], kind); result[kind] = value[kind] }
  return result
}
export function saveSettingsProfile(profile: SettingsProfile): SettingsProfile {
  const library = loadSettingsProfiles(), clean = sanitizeSettingsProfile(profile)
  const existing = library.profiles.find(item => item.id === clean.id)
  if (existing && existing.kind !== clean.kind) throw new Error('A profile cannot change its kind.')
  writeLibrary({ ...library, profiles: existing ? library.profiles.map(item => item.id === clean.id ? clean : item) : [...library.profiles, clean] })
  return clean
}
export function createSettingsProfile(kind: ProfileKind, name: string, sourceId?: string): SettingsProfile {
  const library = loadSettingsProfiles(), source = findProfile(library, sourceId ?? library.defaults[kind], kind)
  return saveSettingsProfile({ ...structuredClone(source), id: `profile-${crypto.randomUUID()}`, name })
}
export function setDefaultSettingsProfile(kind: ProfileKind, id: string): void {
  const library = loadSettingsProfiles(); findProfile(library, id, kind)
  writeLibrary({ ...library, defaults: { ...library.defaults, [kind]: id } })
}
let referenceQueue: Promise<unknown> = Promise.resolve()
export function withProfileReferenceLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = referenceQueue.then(operation)
  referenceQueue = result.catch(() => undefined)
  return result
}
export async function deleteSettingsProfile(id: string): Promise<void> {
  return withProfileReferenceLock(async () => {
    const { database, listSettingsProfileUsage } = await import('../../data/persistence')
    if ((await listSettingsProfileUsage(id)).length) throw new Error('This profile is used by books and cannot be deleted.')
    const db = await database()
    // Serialize with IndexedDB selection writers across browser tabs, then recheck. A writer
    // queued behind this transaction must validate against the newly saved library.
    await db.transaction('rw', db.table('entities'), async () => {
      const rows = await db.table('entities').toArray() as Array<{ id: string; type: string; bookId?: string; settingsType?: string; value?: Record<string, string> }>
      const books = new Set(rows.filter(row => row.type === 'book').map(row => row.id))
      if (rows.some(row => row.settingsType === 'profiles-book' && books.has(row.bookId ?? '') && Object.values(row.value ?? {}).includes(id))) throw new Error('This profile is used by books and cannot be deleted.')
      const library = loadSettingsProfiles()
      if (!library.profiles.some(profile => profile.id === id)) throw new Error('This profile no longer exists.')
      if (Object.values(library.defaults).includes(id)) throw new Error('Default profiles cannot be deleted.')
      if (library.profiles.some(profile => profile.kind === 'text' && [profile.settings.chatPromptPresetId, profile.settings.characterPromptPresetId].includes(id))) throw new Error('This preset is referenced by a text profile and cannot be deleted.')
      storeLibrary(JSON.stringify(validateLibrary({ ...library, profiles: library.profiles.filter(profile => profile.id !== id) })))
    })
    emit()
  })
}

/** Old global settings had only a Chat role. Initialize a never-configured Character role once,
 * not on every runtime read (an explicitly blank role in a saved text profile means Main fallback).
 */
export function initializeLegacyCharacterRole(settings: AiSettings): AiSettings {
  if (settings.characterModel !== '' || settings.characterThinkingEffort !== 'default' || settings.characterMaxModelRounds !== initialAiSettings.characterMaxModelRounds || settings.characterModelContextLength !== undefined) return settings
  return { ...settings, characterModel: settings.chatModel, characterThinkingEffort: settings.chatThinkingEffort, characterMaxModelRounds: settings.chatMaxModelRounds, characterModelContextLength: settings.chatModelContextLength }
}

/** Speech overrides are optional. Never revive a stale saved key for the active provider when
 * its credential was cleared; inactive providers use their own globally stored connection.
 */
export function resolveGlobalSpeechSettings(global = loadAiSettings()): SpeechSettings {
  const providerKey = (provider: 'nanogpt' | 'openai') => (global.provider === provider ? global.apiKey : global.providerProfiles?.[provider]?.apiKey)?.trim() || ''
  return { ...global.speech, apiKey: global.speech.apiKey.trim() || providerKey('nanogpt'), openaiApiKey: global.speech.openaiApiKey.trim() || providerKey('openai') }
}

export function resolveProfileSettings(selections: BookProfileSelections, globalFavorites?: string[]): AiSettings {
  const library = loadSettingsProfiles(); validateBookProfileSelections(selections, library)
  const global = loadAiSettings(), text = findProfile(library, selections.text, 'text').settings
  const settings = normalizeAiSettings(text)
  settings.provider = global.provider; settings.apiKey = global.apiKey; settings.baseUrl = global.baseUrl; settings.providerProfiles = global.providerProfiles
  settings.favorites = [...(globalFavorites ?? global.favorites)]
  for (const kind of ['story', 'codex', 'summary'] as const) {
    const preset = findProfile(library, selections[kind], kind).settings, scope = PROFILE_PROMPT_SCOPES[kind]!
    settings.promptCompositions[scope] = clonePromptComposition(preset.promptCompositions[scope])
    settings.responseLengths[kind] = preset.responseLengths[kind]
  }
  const chat = findProfile(library, text.chatPromptPresetId ?? library.defaults.chat, 'chat')
  settings.promptCompositions.assistant = clonePromptComposition(chat.settings.promptCompositions.assistant)
  settings.prompts = legacyPromptMirror(settings.promptCompositions) as AiSettings['prompts']
  const tts = findProfile(library, selections.tts, 'tts').settings.speech, stt = findProfile(library, selections.stt, 'stt').settings.speech
  const credentials = resolveGlobalSpeechSettings(global)
  settings.speech = { ...tts, apiKey: credentials.apiKey, openaiApiKey: credentials.openaiApiKey, transcriptionModel: stt.transcriptionModel, transcriptionLanguage: stt.transcriptionLanguage, streamTranscription: stt.streamTranscription }
  settings.generationWordDelayMs = findProfile(library, selections.ui, 'ui').settings.generationWordDelayMs
  return settings
}
export function resolveCharacterProfileComposition(selections: BookProfileSelections): PromptComposition {
  const library = loadSettingsProfiles(), text = findProfile(library, selections.text, 'text')
  return clonePromptComposition(findProfile(library, text.settings.characterPromptPresetId ?? library.defaults.character, 'character').settings.promptCompositions.assistant)
}
export function resolveProfileUiSettings(selections?: BookProfileSelections): UiSettings {
  const library = loadSettingsProfiles(), profile = findProfile(library, selections?.ui ?? library.defaults.ui, 'ui')
  if (!profile.ui) throw new Error('The selected UI profile has no UI settings.')
  return structuredClone(profile.ui)
}
export function resolveProfileMediaSettings(selections?: BookProfileSelections): ImageSettings {
  const library = loadSettingsProfiles(), image = findProfile(library, selections?.image ?? library.defaults.image, 'image').media, video = findProfile(library, selections?.video ?? library.defaults.video, 'video').media
  if (!image || !video) throw new Error('The selected media profile has no model settings.')
  const scoped = (media: Omit<ImageSettings, 'keys'>, kind: 'image' | 'video') => structuredClone(media.favorites).flatMap(favorite => {
    const tasks = modelTasks(favorite).filter(task => task.endsWith(kind))
    return tasks.length ? [{ ...favorite, tasks }] : []
  })
  const favorites = scoped(image, 'image')
  for (const favorite of scoped(video, 'video')) {
    const existing = favorites.find(item => item.alias.toLowerCase() === favorite.alias.toLowerCase())
    if (existing) {
      const { tasks: _imageTasks, ...imageModel } = existing, { tasks: _videoTasks, ...videoModel } = favorite
      if (JSON.stringify(imageModel) !== JSON.stringify(videoModel)) throw new Error(`Image and video profiles have conflicting alias “${favorite.alias}”. Rename one alias in Settings.`)
      existing.tasks = [...new Set([...existing.tasks, ...favorite.tasks])]
    } else favorites.push(favorite)
  }
  const defaults = (media: Omit<ImageSettings, 'keys'>, kind: 'image' | 'video') => Object.fromEntries(Object.entries(media.defaultAliases ?? {}).filter(([task]) => task.endsWith(kind)))
  return { keys: { ...loadImageSettings().keys }, favorites, defaultAlias: image.defaultAlias || video.defaultAlias, defaultAliases: { ...defaults(image, 'image'), ...defaults(video, 'video') } }
}

/** Compare only owned fields, so migration neither loses differences nor duplicates unrelated defaults. */
export function profileConfiguration(profile: SettingsProfile): unknown {
  const s = profile.settings, scope = PROFILE_PROMPT_SCOPES[profile.kind]
  if (scope) return { composition: s.promptCompositions[scope], length: s.responseLengths[profile.kind as 'story' | 'codex' | 'summary'] }
  if (profile.kind === 'tts') return { model: s.speech.model, voice: s.speech.voice, readAloudAfterGeneration: s.speech.readAloudAfterGeneration, maxParallelRequests: s.speech.maxParallelRequests }
  if (profile.kind === 'stt') return { transcriptionModel: s.speech.transcriptionModel, transcriptionLanguage: s.speech.transcriptionLanguage, streamTranscription: s.speech.streamTranscription }
  if (profile.kind === 'ui') return { ui: profile.ui, generationWordDelayMs: s.generationWordDelayMs }
  if (profile.kind === 'image' || profile.kind === 'video') return profile.media
  return Object.fromEntries(['mainModel', 'supportModel', 'codexModel', 'chatModel', 'characterModel', 'mainThinkingEffort', 'supportThinkingEffort', 'codexThinkingEffort', 'chatThinkingEffort', 'characterThinkingEffort', 'mainModelContextLength', 'supportModelContextLength', 'codexModelContextLength', 'chatModelContextLength', 'characterModelContextLength', 'mainEffectiveContextLimit', 'codexEffectiveContextLimit', 'chatMaxModelRounds', 'characterMaxModelRounds', 'chatPromptPresetId', 'characterPromptPresetId'].map(key => [key, s[key as keyof AiSettings]]))
}

export function settingsProfilesForSelections(selections: BookProfileSelections): SettingsProfile[] {
  const library = loadSettingsProfiles(); validateBookProfileSelections(selections, library)
  const text = findProfile(library, selections.text, 'text').settings
  const ids = new Set([...Object.values(selections), text.chatPromptPresetId ?? library.defaults.chat, text.characterPromptPresetId ?? library.defaults.character])
  return library.profiles.filter(profile => ids.has(profile.id)).map(profile => sanitizeSettingsProfile(profile.kind === 'text' ? { ...profile, settings: { ...profile.settings, chatPromptPresetId: profile.settings.chatPromptPresetId ?? library.defaults.chat, characterPromptPresetId: profile.settings.characterPromptPresetId ?? library.defaults.character } } : profile))
}

/** Preserve portable IDs when free; clone conflicts and never overwrite shared objects.
 * Reuse byte-equal prior conflict clones, so repeated sync replacement is idempotent.
 * Ordinary archive copies already remap IDs and therefore still create independent profiles.
 */
export function importSettingsProfiles(profiles: SettingsProfile[], selections: BookProfileSelections): BookProfileSelections {
  const library = loadSettingsProfiles(), clean = profiles.map(sanitizeSettingsProfile), ids = new Map<string, string>()
  if (new Set(clean.map(profile => profile.id)).size !== clean.length) throw new Error('Imported profile IDs are not unique.')
  const selectId = (profile: SettingsProfile): string => {
    const local = library.profiles.find(item => item.id === profile.id), definition = JSON.stringify(profile)
    if (!local || JSON.stringify(local) === definition) return profile.id
    const previous = library.profiles.find(item => item.kind === profile.kind && JSON.stringify({ ...item, id: profile.id }) === definition)
    return previous?.id ?? `profile-${crypto.randomUUID()}`
  }
  // Prompt dependencies have no outgoing references. Resolve them before text profiles,
  // whose equality must be checked with the actual locally installed dependency IDs.
  const imported: SettingsProfile[] = []
  for (const profile of [...clean.filter(profile => profile.kind !== 'text'), ...clean.filter(profile => profile.kind === 'text')]) {
    const settings = { ...profile.settings }
    for (const key of ['chatPromptPresetId', 'characterPromptPresetId'] as const) if (settings[key]) {
      if (!ids.has(settings[key]!)) throw new Error('Imported text profile is missing its prompt preset.')
      settings[key] = ids.get(settings[key]!)!
    }
    const id = selectId({ ...profile, settings })
    ids.set(profile.id, id)
    imported.push({ ...profile, id, settings })
  }
  const next = { ...library, profiles: [...library.profiles, ...imported.filter(profile => !library.profiles.some(local => local.id === profile.id))] }
  const result = Object.fromEntries(BOOK_PROFILE_KINDS.map(kind => [kind, ids.get(selections[kind])])) as BookProfileSelections
  validateBookProfileSelections(result, next)
  if (next.profiles.length !== library.profiles.length) writeLibrary(next)
  return result
}
