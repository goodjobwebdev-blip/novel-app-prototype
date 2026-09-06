from pathlib import Path

# New shared request-composition foundation.
Path('src/prompt-composition.ts').write_text(r'''export type PromptCompositionScope = 'story' | 'summarize' | 'lore' | 'assistant'
export type ProviderMessageRole = 'system' | 'user' | 'assistant'
export type PromptOwnership = 'user-configuration' | 'app-managed' | 'conversation' | 'current-turn'
export type PromptSourceKind = 'system-prompt' | 'predefined-message' | 'app-managed' | 'history' | 'current-turn' | 'tool'
export type VariableStability = 'stable' | 'book-state' | 'turn-dynamic'

export type PredefinedMessage = {
  id: string
  name?: string
  role: ProviderMessageRole
  enabled: boolean
  template: string
}

export type PromptComposition = {
  systemPrompt: string
  predefinedMessages: PredefinedMessage[]
}

export type PromptCompositions = Record<PromptCompositionScope, PromptComposition>

export type DynamicContextSource = {
  sourceId: string
  title?: string
  type?: string
  representation?: string
  content: string
  reason?: string
}

export type DynamicVariableDiagnostics = {
  variable: string
  sources: DynamicContextSource[]
}

export type NormalizedRequestPart = {
  id: string
  role?: ProviderMessageRole
  sourceKind: PromptSourceKind
  sourceId?: string
  name?: string
  ownership: PromptOwnership
  content: string
  referencedVariables: string[]
  enabled: boolean
  omitted: boolean
  dynamicVariables?: DynamicVariableDiagnostics[]
}

export type NormalizedAssembledRequest = {
  parts: NormalizedRequestPart[]
  providerMessages: Array<{ role: ProviderMessageRole; content: string }>
}

export type RenderedTemplate = {
  content: string
  referencedVariables: string[]
}

const VARIABLE_PATTERN = /{{\s*([\w.]+)\s*}}/g
const CONDITIONAL_PATTERN = /{%\s*if\s+([\w.]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g

export const PROMPT_COMPOSITION_SCHEMA_VERSION = 1

export function makePredefinedMessage(overrides: Partial<PredefinedMessage> = {}): PredefinedMessage {
  return {
    id: overrides.id?.trim() || `predefined-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: typeof overrides.name === 'string' ? overrides.name : undefined,
    role: overrides.role === 'system' || overrides.role === 'assistant' ? overrides.role : 'user',
    enabled: overrides.enabled !== false,
    template: typeof overrides.template === 'string' ? overrides.template : '',
  }
}

export function normalizePromptComposition(value: unknown, fallbackSystemPrompt = ''): PromptComposition {
  const raw = value && typeof value === 'object' ? value as Partial<PromptComposition> : {}
  const predefined = Array.isArray(raw.predefinedMessages) ? raw.predefinedMessages : []
  const seen = new Set<string>()
  return {
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : fallbackSystemPrompt,
    predefinedMessages: predefined.flatMap((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') return []
      const rawMessage = candidate as Partial<PredefinedMessage>
      let id = typeof rawMessage.id === 'string' && rawMessage.id.trim() ? rawMessage.id.trim() : `predefined-${index + 1}`
      if (seen.has(id)) id = `${id}-${index + 1}`
      seen.add(id)
      const role = rawMessage.role === 'system' || rawMessage.role === 'assistant' ? rawMessage.role : 'user'
      return [{
        id,
        ...(typeof rawMessage.name === 'string' && rawMessage.name.trim() ? { name: rawMessage.name } : {}),
        role,
        enabled: rawMessage.enabled !== false,
        template: typeof rawMessage.template === 'string' ? rawMessage.template : '',
      }]
    }),
  }
}

export function compositionsFromLegacyPrompts(prompts: Record<PromptCompositionScope, string>): PromptCompositions {
  return {
    story: normalizePromptComposition(undefined, prompts.story),
    summarize: normalizePromptComposition(undefined, prompts.summarize),
    lore: normalizePromptComposition(undefined, prompts.lore),
    assistant: normalizePromptComposition(undefined, prompts.assistant),
  }
}

export function normalizePromptCompositions(value: unknown, legacyPrompts: Record<PromptCompositionScope, string>): PromptCompositions {
  const raw = value && typeof value === 'object' ? value as Partial<PromptCompositions> : {}
  return {
    story: normalizePromptComposition(raw.story, legacyPrompts.story),
    summarize: normalizePromptComposition(raw.summarize, legacyPrompts.summarize),
    lore: normalizePromptComposition(raw.lore, legacyPrompts.lore),
    assistant: normalizePromptComposition(raw.assistant, legacyPrompts.assistant),
  }
}

export function legacyPromptMirror(compositions: PromptCompositions): Record<PromptCompositionScope, string> {
  return {
    story: compositions.story.systemPrompt,
    summarize: compositions.summarize.systemPrompt,
    lore: compositions.lore.systemPrompt,
    assistant: compositions.assistant.systemPrompt,
  }
}

export function withSystemPrompt(compositions: PromptCompositions, scope: PromptCompositionScope, systemPrompt: string): PromptCompositions {
  return { ...compositions, [scope]: { ...compositions[scope], systemPrompt } }
}

export function referencedVariables(template: string) {
  const names: string[] = []
  const seen = new Set<string>()
  for (const pattern of [CONDITIONAL_PATTERN, VARIABLE_PATTERN]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(template))) {
      const name = match[1]
      if (!seen.has(name)) { seen.add(name); names.push(name) }
    }
  }
  return names
}

export function withLegacyVariableAliases(values: Record<string, string>) {
  const next = { ...values }
  const story = next['story.so_far'] ?? next['scene.summary_context'] ?? ''
  const additional = next['context.additional'] ?? next.additional_context ?? ''
  next['story.so_far'] = story
  next['scene.summary_context'] = story
  next['context.additional'] = additional
  next.additional_context = additional
  return next
}

export function renderCompositionTemplate(template: string, values: Record<string, string>): RenderedTemplate {
  const normalizedValues = withLegacyVariableAliases(values)
  const references = referencedVariables(template)
  const content = template
    .replace(CONDITIONAL_PATTERN, (_match, key: string, body: string) => normalizedValues[key]?.trim() ? body : '')
    .replace(VARIABLE_PATTERN, (_match, key: string) => normalizedValues[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { content, referencedVariables: references }
}

export function dedupeAdditionalSources(automatic: DynamicContextSource[], additional: DynamicContextSource[]) {
  const automaticIds = new Set(automatic.map((source) => source.sourceId))
  return additional.filter((source) => !automaticIds.has(source.sourceId))
}

export function dynamicSourceMap(input: Record<string, DynamicContextSource[] | undefined>) {
  return Object.fromEntries(Object.entries(input).map(([variable, sources]) => [variable, sources ?? []]))
}

export function renderPromptComposition(
  composition: PromptComposition,
  values: Record<string, string>,
  dynamicSources: Record<string, DynamicContextSource[]> = {},
): NormalizedRequestPart[] {
  const parts: NormalizedRequestPart[] = []
  const add = (part: Omit<NormalizedRequestPart, 'dynamicVariables'>) => {
    const diagnostics = part.referencedVariables
      .filter((name) => dynamicSources[name]?.length)
      .map((variable) => ({ variable, sources: dynamicSources[variable] }))
    parts.push({ ...part, ...(diagnostics.length ? { dynamicVariables: diagnostics } : {}) })
  }
  const system = renderCompositionTemplate(composition.systemPrompt, values)
  add({
    id: 'system-prompt', role: 'system', sourceKind: 'system-prompt', sourceId: 'system-prompt', name: 'System prompt', ownership: 'user-configuration',
    content: system.content, referencedVariables: system.referencedVariables, enabled: true, omitted: !system.content,
  })
  composition.predefinedMessages.forEach((message) => {
    const rendered = renderCompositionTemplate(message.template, values)
    add({
      id: `predefined:${message.id}`, role: message.role, sourceKind: 'predefined-message', sourceId: message.id, name: message.name,
      ownership: 'user-configuration', content: rendered.content, referencedVariables: rendered.referencedVariables,
      enabled: message.enabled, omitted: !message.enabled || !rendered.content,
    })
  })
  return parts
}

export function normalizeAppManagedPart(part: {
  id: string
  role?: ProviderMessageRole
  sourceKind: Exclude<PromptSourceKind, 'system-prompt' | 'predefined-message'>
  sourceId?: string
  name?: string
  ownership: Exclude<PromptOwnership, 'user-configuration'>
  content: string
  referencedVariables?: string[]
  dynamicVariables?: DynamicVariableDiagnostics[]
}): NormalizedRequestPart {
  return {
    ...part,
    content: part.content,
    referencedVariables: part.referencedVariables ?? [],
    enabled: true,
    omitted: !part.content.trim(),
  }
}

export function assembleNormalizedRequest(parts: NormalizedRequestPart[]): NormalizedAssembledRequest {
  const providerMessages = parts.flatMap((part) => !part.omitted && part.role
    ? [{ role: part.role, content: part.content }]
    : [])
  return { parts, providerMessages }
}

export function assembleCompositionRequest(input: {
  composition: PromptComposition
  values: Record<string, string>
  dynamicSources?: Record<string, DynamicContextSource[]>
  before?: NormalizedRequestPart[]
  after?: NormalizedRequestPart[]
}): NormalizedAssembledRequest {
  return assembleNormalizedRequest([
    ...(input.before ?? []),
    ...renderPromptComposition(input.composition, input.values, input.dynamicSources),
    ...(input.after ?? []),
  ])
}

export function likelyReusablePrefix(parts: NormalizedRequestPart[], stabilityFor: (variable: string) => VariableStability | undefined) {
  let count = 0
  for (const part of parts) {
    if (part.omitted) continue
    if (part.ownership !== 'user-configuration') break
    if (part.referencedVariables.some((variable) => stabilityFor(variable) === 'turn-dynamic')) break
    count += 1
  }
  return count
}
''')

# Extend prompt-template catalog and delegate rendering to the shared foundation.
p = Path('src/prompt-template.ts')
text = p.read_text()
text = "import { renderCompositionTemplate, type VariableStability } from './prompt-composition'\n\n" + text
text = text.replace("""export type PromptVariable = {\n  name: string\n  description: string\n  scopes: PromptScope[]\n}\n""", """export type PromptVariable = {\n  name: string\n  description: string\n  scopes: PromptScope[]\n  stability: VariableStability\n  canonical?: boolean\n  aliasFor?: string\n}\n""", 1)
start = text.index('export const promptVariables: PromptVariable[] = [')
end = text.index('\n]\n\nexport function bookTemplateValues', start) + 2
replacement = r'''export const promptVariables: PromptVariable[] = [
  { name: 'book.title', description: 'Current book title', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.series', description: 'Series title, empty for standalone books', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.series_order', description: 'Position of the book within its series', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.overview', description: 'Book overview from the Book tab', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.genre', description: 'Genre or combination of genres', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.style', description: 'Preferred writing style', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.pov', description: 'Default point of view for the book', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.tense', description: 'Default narrative tense', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: 'book.language', description: 'Primary writing language', scopes: everyPrompt, stability: 'book-state', canonical: true },
  { name: RESPONSE_LENGTH_VARIABLE, description: 'Response-length guidance from AI settings', scopes: ['story', 'lore', 'assistant'], stability: 'book-state', canonical: true },
  { name: 'scene.text', description: 'Current Scene used as the generation anchor', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.pov', description: 'Scene-specific POV when one is set', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.previous_text', description: 'Previous Scene when the scope automatic rules expose it', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'story.so_far', description: 'Hierarchically compressed earlier story state', scopes: ['story', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic', description: 'Complete automatically assembled dynamic context for this scope', scopes: everyPrompt, stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic_codex', description: 'Codex entries automatically selected by trigger/dependency rules', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.additional', description: 'Sources explicitly selected in Context Management after automatic-source deduplication', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'target.type', description: 'The requested summary target', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'target.previous_summary', description: 'Existing summary when re-summarizing', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.title', description: 'Current Codex entry title', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.category', description: 'Current Codex entry category', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.content', description: 'Existing Codex entry Markdown', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'scene.summary_context', description: 'Legacy alias for story.so_far', scopes: ['story'], stability: 'turn-dynamic', aliasFor: 'story.so_far' },
  { name: 'additional_context', description: 'Legacy alias for context.additional', scopes: ['story', 'lore'], stability: 'turn-dynamic', aliasFor: 'context.additional' },
]'''
text = text[:start] + replacement + text[end:]
old_render = r'''export function renderPromptTemplate(template: string, values: Record<string, string>) {
  return template
    .replace(/{%\s*if\s+([\w.]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g, (_match, key: string, body: string) => values[key]?.trim() ? body : '')
    .replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => values[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
'''
new_render = r'''export function renderPromptTemplate(template: string, values: Record<string, string>) {
  return renderCompositionTemplate(template, values).content
}

export function promptVariableStability(name: string) {
  return promptVariables.find((variable) => variable.name === name)?.stability
}
'''
if old_render not in text: raise SystemExit('prompt renderer target not found')
text = text.replace(old_render, new_render, 1)
p.write_text(text)

# Ai settings: versioned composition source of truth + runtime legacy mirror, stripped from persistence.
p = Path('src/ai-settings.ts')
text = p.read_text()
text = "import { PROMPT_COMPOSITION_SCHEMA_VERSION, compositionsFromLegacyPrompts, legacyPromptMirror, normalizePromptCompositions, withSystemPrompt, type PromptCompositions, type PromptCompositionScope } from './prompt-composition'\n\n" + text
text = text.replace("""  speech: SpeechSettings\n  favorites: string[]\n  prompts: AiPrompts\n}\n\nexport type BookAiSettings = Omit<AiSettings, 'favorites'>\n""", """  speech: SpeechSettings\n  favorites: string[]\n  promptCompositionVersion: number\n  promptCompositions: PromptCompositions\n  /** Runtime compatibility mirror. New persistence omits this legacy field. */\n  prompts: AiPrompts\n}\n\nexport type BookAiSettings = Omit<AiSettings, 'favorites' | 'prompts'> & { prompts?: AiPrompts }\n""", 1)
text = text.replace("""export const initialAiSettings: AiSettings = {\n""", """export const defaultPromptCompositions: PromptCompositions = compositionsFromLegacyPrompts(defaultAiPrompts)\n\nexport const initialAiSettings: AiSettings = {\n""", 1)
text = text.replace("""  favorites: [],\n  prompts: defaultAiPrompts,\n}\n""", """  favorites: [],\n  promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,\n  promptCompositions: defaultPromptCompositions,\n  prompts: defaultAiPrompts,\n}\n""", 1)
old_normalize = """  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {\n    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]\n  })\n  return {\n"""
new_normalize = """  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {\n    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]\n  })\n  const promptCompositions = normalizePromptCompositions(value?.promptCompositions, prompts)\n  const promptMirror = legacyPromptMirror(promptCompositions) as AiPrompts\n  return {\n"""
if old_normalize not in text: raise SystemExit('normalize insertion target not found')
text = text.replace(old_normalize, new_normalize, 1)
text = text.replace("""    codexEffectiveContextLimit: typeof value?.codexEffectiveContextLimit === 'string' ? value.codexEffectiveContextLimit : '',\n    prompts,\n    favorites: Array.isArray(value?.favorites) ? [...value.favorites] : [],\n""", """    codexEffectiveContextLimit: typeof value?.codexEffectiveContextLimit === 'string' ? value.codexEffectiveContextLimit : '',\n    promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,\n    promptCompositions,\n    prompts: promptMirror,\n    favorites: Array.isArray(value?.favorites) ? [...value.favorites] : [],\n""", 1)
text = text.replace("""export function toBookAiSettings(settings: AiSettings): BookAiSettings {\n  const { favorites: _globalFavorites, ...bookSettings } = copyAiSettings(settings)\n  return bookSettings\n}\n""", """export function toBookAiSettings(settings: AiSettings): BookAiSettings {\n  const { favorites: _globalFavorites, prompts: _legacyPromptMirror, ...bookSettings } = copyAiSettings(settings)\n  return bookSettings\n}\n\nexport function withPromptSystemPrompt(settings: AiSettings, scope: PromptCompositionScope, systemPrompt: string): AiSettings {\n  return normalizeAiSettings({ ...settings, promptCompositions: withSystemPrompt(settings.promptCompositions, scope, systemPrompt), prompts: undefined as unknown as AiPrompts })\n}\n\nexport function resetPromptComposition(settings: AiSettings, scope: PromptCompositionScope): AiSettings {\n  return normalizeAiSettings({ ...settings, promptCompositions: { ...settings.promptCompositions, [scope]: defaultPromptCompositions[scope] }, prompts: undefined as unknown as AiPrompts })\n}\n""", 1)
text = text.replace("""export function saveAiSettings(settings: AiSettings) {\n  const normalized = copyAiSettings(settings)\n  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))\n  return normalized\n}\n""", """export function saveAiSettings(settings: AiSettings) {\n  const normalized = copyAiSettings(settings)\n  const { prompts: _legacyPromptMirror, ...persisted } = normalized\n  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))\n  return normalized\n}\n""", 1)
p.write_text(text)

# Current single System-prompt editor writes the new composition source of truth.
p = Path('src/App.tsx')
text = p.read_text()
text = text.replace("""  saveGlobalFavorites,\n  type AiPrompts,\n""", """  saveGlobalFavorites,\n  resetPromptComposition,\n  withPromptSystemPrompt,\n  type AiPrompts,\n""", 1)
text = text.replace("""          <textarea className=\"prompt-editor\" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />\n""", """          <textarea className=\"prompt-editor\" value={settings.promptCompositions[promptTab].systemPrompt} onChange={(event) => changeAiSettings((current) => withPromptSystemPrompt(current, promptTab, event.target.value))} spellCheck={false} />\n""", 1)
text = text.replace("""          <div className=\"prompt-footer\"><button type=\"button\" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultAiPrompts[promptTab] })}>Reset default</button></div>\n""", """          <div className=\"prompt-footer\"><button type=\"button\" onClick={() => changeAiSettings((current) => resetPromptComposition(current, promptTab))}>Reset default</button></div>\n""", 1)
p.write_text(text)

# Focused tests.
Path('tests/prompt-composition.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleCompositionRequest,
  assembleNormalizedRequest,
  compositionsFromLegacyPrompts,
  dedupeAdditionalSources,
  likelyReusablePrefix,
  normalizeAppManagedPart,
  normalizePromptComposition,
  renderCompositionTemplate,
} from '../src/prompt-composition.ts'
import { promptVariableStability, renderPromptTemplate } from '../src/prompt-template.ts'

test('legacy single prompts migrate losslessly into System slots with no invented predefined messages', () => {
  const legacy = { story: 'custom story {{scene.text}}', summarize: 'sum', lore: 'lore', assistant: 'chat' }
  const compositions = compositionsFromLegacyPrompts(legacy)
  assert.equal(compositions.story.systemPrompt, legacy.story)
  assert.deepEqual(compositions.story.predefinedMessages, [])
})

test('predefined messages preserve authored order and roles while disabled/empty rows are omitted', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'System {{book.title}}', predefinedMessages: [
    { id: 'a', role: 'assistant', enabled: true, template: 'Example' },
    { id: 'b', role: 'system', enabled: false, template: 'Disabled' },
    { id: 'c', role: 'user', enabled: true, template: '{% if context.additional %}{{context.additional}}{% endif %}' },
  ]})
  const request = assembleCompositionRequest({ composition, values: { 'book.title': 'Tide', 'context.additional': '' } })
  assert.deepEqual(request.providerMessages, [
    { role: 'system', content: 'System Tide' },
    { role: 'assistant', content: 'Example' },
  ])
  assert.equal(request.parts.find((part) => part.sourceId === 'b')?.omitted, true)
  assert.equal(request.parts.find((part) => part.sourceId === 'c')?.omitted, true)
})

test('legacy variable aliases render canonical values without rewriting authored templates', () => {
  assert.equal(renderCompositionTemplate('{{scene.summary_context}} / {{additional_context}}', {
    'story.so_far': 'Earlier story', 'context.additional': 'Manual lore',
  }).content, 'Earlier story / Manual lore')
  assert.equal(renderPromptTemplate('{{story.so_far}} / {{context.additional}}', {
    'scene.summary_context': 'Earlier story', additional_context: 'Manual lore',
  }), 'Earlier story / Manual lore')
})

test('automatic sources dedupe Additional by stable source identity, not rendered text', () => {
  const auto = [{ sourceId: 'codex-a', representation: 'Summary', content: 'same' }]
  const additional = [
    { sourceId: 'codex-a', representation: 'Full entry', content: 'different' },
    { sourceId: 'note-b', content: 'same' },
  ]
  assert.deepEqual(dedupeAdditionalSources(auto, additional).map((source) => source.sourceId), ['note-b'])
})

test('normalized request parts preserve ownership/source metadata and exact provider role order', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'S', predefinedMessages: [{ id: 'few-shot', name: 'Example', role: 'assistant', enabled: true, template: 'A' }] })
  const current = normalizeAppManagedPart({ id: 'turn', role: 'user', sourceKind: 'current-turn', ownership: 'current-turn', content: 'U' })
  const request = assembleCompositionRequest({ composition, values: {}, after: [current] })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.equal(request.parts[1].ownership, 'user-configuration')
  assert.equal(request.parts[2].sourceKind, 'current-turn')
})

test('likely reusable prefix stops before turn-dynamic authored variables', () => {
  const request = assembleNormalizedRequest([
    { id: 's', role: 'system', sourceKind: 'system-prompt', ownership: 'user-configuration', content: 'stable', referencedVariables: [], enabled: true, omitted: false },
    { id: 'book', role: 'system', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'book', referencedVariables: ['book.title'], enabled: true, omitted: false },
    { id: 'scene', role: 'user', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'scene', referencedVariables: ['scene.text'], enabled: true, omitted: false },
  ])
  assert.equal(likelyReusablePrefix(request.parts, promptVariableStability), 2)
})
''')
