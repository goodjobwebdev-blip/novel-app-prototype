from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

Path('src/prompt-composition.ts').write_text(r'''export type PromptCompositionScope = 'story' | 'summarize' | 'lore' | 'assistant'
export type ProviderMessageRole = 'system' | 'user' | 'assistant'
export type PromptOwnership = 'user-configuration' | 'app-managed' | 'conversation' | 'current-turn'
export type PromptSourceKind = 'system-prompt' | 'predefined-message' | 'app-managed' | 'history' | 'current-turn'
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

export type ProviderRoleSupport = Partial<Record<ProviderMessageRole, boolean>>

const VARIABLE_PATTERN = /{{\s*([\w.]+)\s*}}/g
const CONDITIONAL_PATTERN = /{%\s*if\s+([\w.]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g
const LEGACY_ALIASES: Record<string, string> = {
  'scene.summary_context': 'story.so_far',
  additional_context: 'context.additional',
}

export const PROMPT_COMPOSITION_SCHEMA_VERSION = 1

export function makePredefinedMessage(overrides: Partial<PredefinedMessage> = {}): PredefinedMessage {
  return {
    id: overrides.id?.trim() || `predefined-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...(typeof overrides.name === 'string' && overrides.name.trim() ? { name: overrides.name.trim() } : {}),
    role: overrides.role === 'system' || overrides.role === 'assistant' ? overrides.role : 'user',
    enabled: overrides.enabled !== false,
    template: typeof overrides.template === 'string' ? overrides.template : '',
  }
}

export function normalizePromptComposition(value: unknown, fallbackSystemPrompt = ''): PromptComposition {
  const raw = value && typeof value === 'object' ? value as Partial<PromptComposition> : {}
  const candidates = Array.isArray(raw.predefinedMessages) ? raw.predefinedMessages : []
  const seen = new Set<string>()
  const predefinedMessages: PredefinedMessage[] = candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return []
    const input = candidate as Partial<PredefinedMessage>
    let id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `predefined-${index + 1}`
    if (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    return [{
      id,
      ...(typeof input.name === 'string' && input.name.trim() ? { name: input.name.trim() } : {}),
      role: input.role === 'system' || input.role === 'assistant' ? input.role : 'user',
      enabled: input.enabled !== false,
      template: typeof input.template === 'string' ? input.template : '',
    }]
  })
  return {
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : fallbackSystemPrompt,
    predefinedMessages,
  }
}

export function clonePromptComposition(value: PromptComposition): PromptComposition {
  return {
    systemPrompt: value.systemPrompt,
    predefinedMessages: value.predefinedMessages.map((message) => ({ ...message })),
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
  return {
    ...compositions,
    [scope]: { ...compositions[scope], systemPrompt },
  }
}

export function canonicalVariableName(name: string) {
  return LEGACY_ALIASES[name] ?? name
}

export function referencedVariables(template: string) {
  const names: string[] = []
  const seen = new Set<string>()
  for (const pattern of [CONDITIONAL_PATTERN, VARIABLE_PATTERN]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(template))) {
      const name = match[1]
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

export function withLegacyVariableAliases(values: Record<string, string>) {
  const next = { ...values }
  const storySoFar = next['story.so_far'] ?? next['scene.summary_context'] ?? ''
  const additional = next['context.additional'] ?? next.additional_context ?? ''
  next['story.so_far'] = storySoFar
  next['scene.summary_context'] = storySoFar
  next['context.additional'] = additional
  next.additional_context = additional
  return next
}

export function renderCompositionTemplate(template: string, values: Record<string, string>): RenderedTemplate {
  const normalizedValues = withLegacyVariableAliases(values)
  const references = referencedVariables(template)
  const conditional = new RegExp(CONDITIONAL_PATTERN.source, 'g')
  const variable = new RegExp(VARIABLE_PATTERN.source, 'g')
  const content = template
    .replace(conditional, (_match, key: string, body: string) => normalizedValues[key]?.trim() ? body : '')
    .replace(variable, (_match, key: string) => normalizedValues[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { content, referencedVariables: references }
}

export function dedupeAdditionalSources(automatic: DynamicContextSource[], additional: DynamicContextSource[]) {
  const automaticIds = new Set(automatic.map((source) => source.sourceId))
  return additional.filter((source) => !automaticIds.has(source.sourceId))
}

function diagnosticsForVariables(references: string[], dynamicSources: Record<string, DynamicContextSource[]>) {
  return references.flatMap((variable) => {
    const canonical = canonicalVariableName(variable)
    const sources = dynamicSources[variable] ?? dynamicSources[canonical] ?? []
    return sources.length ? [{ variable, sources }] : []
  })
}

export function renderPromptComposition(
  composition: PromptComposition,
  values: Record<string, string>,
  dynamicSources: Record<string, DynamicContextSource[]> = {},
): NormalizedRequestPart[] {
  const parts: NormalizedRequestPart[] = []
  const system = renderCompositionTemplate(composition.systemPrompt, values)
  parts.push({
    id: 'system-prompt',
    role: 'system',
    sourceKind: 'system-prompt',
    sourceId: 'system-prompt',
    name: 'System prompt',
    ownership: 'user-configuration',
    content: system.content,
    referencedVariables: system.referencedVariables,
    enabled: true,
    omitted: !system.content,
    ...(diagnosticsForVariables(system.referencedVariables, dynamicSources).length
      ? { dynamicVariables: diagnosticsForVariables(system.referencedVariables, dynamicSources) }
      : {}),
  })
  for (const message of composition.predefinedMessages) {
    const rendered = renderCompositionTemplate(message.template, values)
    const diagnostics = diagnosticsForVariables(rendered.referencedVariables, dynamicSources)
    parts.push({
      id: `predefined:${message.id}`,
      role: message.role,
      sourceKind: 'predefined-message',
      sourceId: message.id,
      name: message.name,
      ownership: 'user-configuration',
      content: rendered.content,
      referencedVariables: rendered.referencedVariables,
      enabled: message.enabled,
      omitted: !message.enabled || !rendered.content,
      ...(diagnostics.length ? { dynamicVariables: diagnostics } : {}),
    })
  }
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
  after?: NormalizedRequestPart[]
}): NormalizedAssembledRequest {
  return assembleNormalizedRequest([
    ...renderPromptComposition(input.composition, input.values, input.dynamicSources),
    ...(input.after ?? []),
  ])
}

export function providerCompatibilityError(request: NormalizedAssembledRequest, supportedRoles: ProviderRoleSupport) {
  const unsupported = request.parts.find((part) => !part.omitted && part.role && supportedRoles[part.role] === false)
  return unsupported?.role
    ? `The selected provider/model cannot represent the configured ${unsupported.role} message “${unsupported.name ?? unsupported.sourceId ?? unsupported.id}” without changing its meaning.`
    : ''
}

export function providerMessagesFromNormalized(request: NormalizedAssembledRequest, supportedRoles: ProviderRoleSupport = {}) {
  const compatibilityError = providerCompatibilityError(request, supportedRoles)
  if (compatibilityError) throw new Error(compatibilityError)
  return request.providerMessages.map((message) => ({ ...message }))
}

export function normalizedRequestDiagnosticText(request: NormalizedAssembledRequest) {
  return JSON.stringify({ messages: request.providerMessages })
}

export function likelyReusablePrefix(parts: NormalizedRequestPart[], stabilityFor: (variable: string) => VariableStability | undefined) {
  let partCount = 0
  const dynamicVariables = new Set<string>()
  for (const part of parts) {
    if (part.omitted) continue
    if (part.ownership !== 'user-configuration') break
    const turnDynamic = part.referencedVariables.filter((variable) => stabilityFor(canonicalVariableName(variable)) === 'turn-dynamic')
    if (turnDynamic.length) {
      turnDynamic.forEach((variable) => dynamicVariables.add(variable))
      break
    }
    partCount += 1
  }
  return { partCount, dynamicVariables: [...dynamicVariables] }
}
''')

# Extend the shared variable catalog and route legacy rendering through the foundation.
p = Path('src/prompt-template.ts')
text = p.read_text()
if not text.startswith("import { renderCompositionTemplate"):
    text = "import { canonicalVariableName, renderCompositionTemplate, type VariableStability } from './prompt-composition'\n\n" + text
text = replace_once(text, """export type PromptVariable = {
  name: string
  description: string
  scopes: PromptScope[]
}
""", """export type PromptVariable = {
  name: string
  description: string
  scopes: PromptScope[]
  stability: VariableStability
  canonical?: boolean
  aliasFor?: string
}
""", 'PromptVariable shape')
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
  { name: 'scene.previous_text', description: 'Previous Scene when automatic rules expose it', scopes: ['story'], stability: 'turn-dynamic', canonical: true },
  { name: 'story.so_far', description: 'Hierarchically compressed earlier-story state', scopes: ['story', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic', description: 'Complete automatically assembled context for this scope', scopes: everyPrompt, stability: 'turn-dynamic', canonical: true },
  { name: 'context.automatic_codex', description: 'Codex entries automatically selected through trigger/dependency rules', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'context.additional', description: 'Only context explicitly selected through Context Management', scopes: ['story', 'lore', 'assistant'], stability: 'turn-dynamic', canonical: true },
  { name: 'target.type', description: 'The current Summary target type', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'target.previous_summary', description: 'Existing summary when re-summarizing', scopes: ['summarize'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.title', description: 'Current Codex entry title', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.category', description: 'Current Codex entry category', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
  { name: 'entry.content', description: 'Current/existing Codex entry Markdown', scopes: ['lore'], stability: 'turn-dynamic', canonical: true },
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
  const canonical = canonicalVariableName(name)
  return promptVariables.find((variable) => variable.name === canonical)?.stability
}
'''
text = replace_once(text, old_render, new_render, 'renderPromptTemplate')
p.write_text(text)

# AI settings: versioned PromptComposition becomes persisted source of truth.
p = Path('src/ai-settings.ts')
text = p.read_text()
if not text.startswith("import { PROMPT_COMPOSITION_SCHEMA_VERSION"):
    text = "import { PROMPT_COMPOSITION_SCHEMA_VERSION, clonePromptComposition, compositionsFromLegacyPrompts, legacyPromptMirror, normalizePromptCompositions, withSystemPrompt, type PromptCompositions, type PromptCompositionScope } from './prompt-composition'\n\n" + text
text = replace_once(text, """  speech: SpeechSettings
  favorites: string[]
  prompts: AiPrompts
}

export type BookAiSettings = Omit<AiSettings, 'favorites'>
""", """  speech: SpeechSettings
  favorites: string[]
  promptCompositionVersion: number
  promptCompositions: PromptCompositions
  /** Runtime compatibility mirror for pre-#119 consumers. New persistence omits this legacy field. */
  prompts: AiPrompts
}

export type BookAiSettings = Omit<AiSettings, 'favorites' | 'prompts'> & { prompts?: AiPrompts }
""", 'AiSettings composition fields')
text = replace_once(text, 'export const initialAiSettings: AiSettings = {\n', 'export const defaultPromptCompositions: PromptCompositions = compositionsFromLegacyPrompts(defaultAiPrompts)\n\nexport const initialAiSettings: AiSettings = {\n', 'default compositions')
text = replace_once(text, """  speech: initialSpeechSettings,
  favorites: [],
  prompts: defaultAiPrompts,
}
""", """  speech: initialSpeechSettings,
  favorites: [],
  promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,
  promptCompositions: defaultPromptCompositions,
  prompts: defaultAiPrompts,
}
""", 'initial composition values')
old_insertion = """  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {
    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]
  })
  return {
"""
new_insertion = """  ;(Object.keys(defaultAiPrompts) as Array<keyof AiPrompts>).forEach((key) => {
    if (previousDefaultAiPrompts.some((defaults) => prompts[key] === defaults[key])) prompts[key] = defaultAiPrompts[key]
  })
  const promptCompositions = normalizePromptCompositions(value?.promptCompositions, prompts)
  const promptMirror = legacyPromptMirror(promptCompositions) as AiPrompts
  return {
"""
text = replace_once(text, old_insertion, new_insertion, 'normalize composition migration')
text = replace_once(text, """    speech: normalizeSpeechSettings(value?.speech),
    mainEffectiveContextLimit: typeof value?.mainEffectiveContextLimit === 'string' ? value.mainEffectiveContextLimit : '',
""", """    speech: normalizeSpeechSettings(value?.speech),
    promptCompositionVersion: PROMPT_COMPOSITION_SCHEMA_VERSION,
    promptCompositions,
    prompts: promptMirror,
    mainEffectiveContextLimit: typeof value?.mainEffectiveContextLimit === 'string' ? value.mainEffectiveContextLimit : '',
""", 'normalized composition fields')
text = replace_once(text, """export function toBookAiSettings(settings: AiSettings): BookAiSettings {
  const { favorites: _globalFavorites, ...bookSettings } = copyAiSettings(settings)
  return bookSettings
}
""", """export function toBookAiSettings(settings: AiSettings): BookAiSettings {
  const { favorites: _globalFavorites, prompts: _legacyPromptMirror, ...bookSettings } = copyAiSettings(settings)
  return bookSettings
}

export function withPromptSystemPrompt(settings: AiSettings, scope: PromptCompositionScope, systemPrompt: string): AiSettings {
  return normalizeAiSettings({
    ...settings,
    promptCompositions: withSystemPrompt(settings.promptCompositions, scope, systemPrompt),
    prompts: undefined as unknown as AiPrompts,
  })
}

export function resetPromptComposition(settings: AiSettings, scope: PromptCompositionScope): AiSettings {
  return normalizeAiSettings({
    ...settings,
    promptCompositions: {
      ...settings.promptCompositions,
      [scope]: clonePromptComposition(defaultPromptCompositions[scope]),
    },
    prompts: undefined as unknown as AiPrompts,
  })
}
""", 'Book settings and prompt helpers')
text = replace_once(text, """export function saveAiSettings(settings: AiSettings) {
  const normalized = copyAiSettings(settings)
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}
""", """export function saveAiSettings(settings: AiSettings) {
  const normalized = copyAiSettings(settings)
  const { prompts: _legacyPromptMirror, ...persisted } = normalized
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(persisted))
  return normalized
}
""", 'strip legacy default prompt persistence')
p.write_text(text)

# Existing System prompt UI writes only the System slot of the new composition model.
p = Path('src/App.tsx')
text = p.read_text()
text = replace_once(text, """  defaultAiPrompts,
  initialAiSettings,
""", """  initialAiSettings,
""", 'remove legacy default prompt import')
text = replace_once(text, """  saveGlobalFavorites,
  type AiPrompts,
""", """  saveGlobalFavorites,
  resetPromptComposition,
  withPromptSystemPrompt,
  type AiPrompts,
""", 'prompt helper imports')
text = replace_once(text, """          <textarea className="prompt-editor" value={settings.prompts[promptTab]} onChange={(event) => update('prompts', { ...settings.prompts, [promptTab]: event.target.value })} spellCheck={false} />
""", """          <textarea className="prompt-editor" value={settings.promptCompositions[promptTab].systemPrompt} onChange={(event) => changeAiSettings((current) => withPromptSystemPrompt(current, promptTab, event.target.value))} spellCheck={false} />
""", 'System prompt editor')
text = replace_once(text, """          <div className="prompt-footer"><button type="button" onClick={() => update('prompts', { ...settings.prompts, [promptTab]: defaultAiPrompts[promptTab] })}>Reset default</button></div>
""", """          <div className="prompt-footer"><button type="button" onClick={() => changeAiSettings((current) => resetPromptComposition(current, promptTab))}>Reset prompt composition</button></div>
""", 'composition reset')
p.write_text(text)

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
  normalizedRequestDiagnosticText,
  providerCompatibilityError,
  providerMessagesFromNormalized,
  renderCompositionTemplate,
} from '../src/prompt-composition.ts'
import { promptVariableStability, promptVariables, renderPromptTemplate } from '../src/prompt-template.ts'

test('legacy single prompts migrate losslessly into System slots without invented predefined messages', () => {
  const legacy = { story: 'custom story {{scene.text}}', summarize: 'sum', lore: 'lore', assistant: 'chat' }
  const compositions = compositionsFromLegacyPrompts(legacy)
  assert.equal(compositions.story.systemPrompt, legacy.story)
  assert.deepEqual(compositions.story.predefinedMessages, [])
})

test('predefined messages preserve authored role/order and omit disabled or empty rendered rows', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'System {{book.title}}', predefinedMessages: [
    { id: 'a', role: 'assistant', enabled: true, template: 'Example' },
    { id: 'b', role: 'system', enabled: false, template: 'Disabled' },
    { id: 'c', role: 'user', enabled: true, template: '{% if context.additional %}{{context.additional}}{% endif %}' },
    { id: 'd', role: 'user', enabled: true, template: 'Turn framing' },
  ]})
  const request = assembleCompositionRequest({ composition, values: { 'book.title': 'Book', 'context.additional': '' } })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.deepEqual(request.providerMessages.map((message) => message.content), ['System Book', 'Example', 'Turn framing'])
  assert.equal(request.parts.find((part) => part.sourceId === 'b')?.omitted, true)
  assert.equal(request.parts.find((part) => part.sourceId === 'c')?.omitted, true)
})

test('legacy aliases render canonical values without rewriting authored templates', () => {
  assert.equal(renderCompositionTemplate('{{scene.summary_context}} / {{additional_context}}', {
    'story.so_far': 'Earlier story', 'context.additional': 'Manual lore',
  }).content, 'Earlier story / Manual lore')
  assert.equal(renderPromptTemplate('{{story.so_far}} / {{context.additional}}', {
    'scene.summary_context': 'Earlier story', additional_context: 'Manual lore',
  }), 'Earlier story / Manual lore')
})

test('automatic sources dedupe Additional by stable source identity, not rendered text or representation', () => {
  const automatic = [{ sourceId: 'codex-a', representation: 'Summary', content: 'same' }]
  const additional = [
    { sourceId: 'codex-a', representation: 'Full entry', content: 'different' },
    { sourceId: 'note-b', content: 'same' },
  ]
  assert.deepEqual(dedupeAdditionalSources(automatic, additional).map((source) => source.sourceId), ['note-b'])
})

test('normalized request retains ownership/source metadata and is the source for serialization and diagnostics', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'S', predefinedMessages: [
    { id: 'few-shot', name: 'Example', role: 'assistant', enabled: true, template: 'A' },
  ]})
  const current = normalizeAppManagedPart({ id: 'turn', role: 'user', sourceKind: 'current-turn', ownership: 'current-turn', content: 'U' })
  const request = assembleCompositionRequest({ composition, values: {}, after: [current] })
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant', 'user'])
  assert.deepEqual(providerMessagesFromNormalized(request), request.providerMessages)
  assert.equal(normalizedRequestDiagnosticText(request), JSON.stringify({ messages: request.providerMessages }))
  assert.equal(request.parts[1].ownership, 'user-configuration')
  assert.equal(request.parts[2].sourceKind, 'current-turn')
})

test('provider role incompatibility is explicit and never silently rewritten', () => {
  const request = assembleCompositionRequest({
    composition: normalizePromptComposition({ systemPrompt: 'S', predefinedMessages: [{ id: 'a', role: 'assistant', enabled: true, template: 'A' }] }),
    values: {},
  })
  assert.match(providerCompatibilityError(request, { system: true, user: true, assistant: false }), /cannot represent the configured assistant message/)
  assert.throws(() => providerMessagesFromNormalized(request, { system: true, user: true, assistant: false }), /cannot represent/)
  assert.deepEqual(request.providerMessages.map((message) => message.role), ['system', 'assistant'])
})

test('dynamic source diagnostics stay attached to variables without splitting provider messages', () => {
  const composition = normalizePromptComposition({ systemPrompt: 'Use {{context.automatic}} and {{context.additional}}.' })
  const request = assembleCompositionRequest({
    composition,
    values: { 'context.automatic': 'AUTO', 'context.additional': 'ADD' },
    dynamicSources: {
      'context.automatic': [{ sourceId: 'scene-1', representation: 'Full', content: 'AUTO' }],
      'context.additional': [{ sourceId: 'note-1', representation: 'Full', content: 'ADD' }],
    },
  })
  assert.equal(request.providerMessages.length, 1)
  assert.deepEqual(request.parts[0].dynamicVariables?.map((item) => item.variable), ['context.automatic', 'context.additional'])
})

test('user-authored overlapping variables are rendered where authored without semantic deduplication', () => {
  const composition = normalizePromptComposition({ systemPrompt: '{{story.so_far}}', predefinedMessages: [{ id: 'a', role: 'user', enabled: true, template: '{{context.automatic}}' }] })
  const request = assembleCompositionRequest({ composition, values: { 'story.so_far': 'same', 'context.automatic': 'same' } })
  assert.deepEqual(request.providerMessages.map((message) => message.content), ['same', 'same'])
})

test('variable catalog exposes canonical context names, legacy aliases, and stability metadata', () => {
  for (const name of ['story.so_far', 'context.automatic', 'context.automatic_codex', 'context.additional']) {
    const variable = promptVariables.find((item) => item.name === name)
    assert.equal(variable?.canonical, true)
    assert.equal(variable?.stability, 'turn-dynamic')
  }
  assert.equal(promptVariables.find((item) => item.name === 'scene.summary_context')?.aliasFor, 'story.so_far')
  assert.equal(promptVariables.find((item) => item.name === 'additional_context')?.aliasFor, 'context.additional')
  assert.equal(promptVariableStability('book.title'), 'book-state')
  assert.equal(promptVariableStability('scene.summary_context'), 'turn-dynamic')
})

test('likely reusable prefix stops before the first turn-dynamic authored part', () => {
  const request = assembleNormalizedRequest([
    { id: 's', role: 'system', sourceKind: 'system-prompt', ownership: 'user-configuration', content: 'stable', referencedVariables: [], enabled: true, omitted: false },
    { id: 'book', role: 'system', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'book', referencedVariables: ['book.title'], enabled: true, omitted: false },
    { id: 'scene', role: 'user', sourceKind: 'predefined-message', ownership: 'user-configuration', content: 'scene', referencedVariables: ['scene.text'], enabled: true, omitted: false },
  ])
  assert.deepEqual(likelyReusablePrefix(request.parts, promptVariableStability), { partCount: 2, dynamicVariables: ['scene.text'] })
})
''')

Path('tests/ai-settings-prompt-composition.test.mjs').write_text(r'''import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_SETTINGS_STORAGE_KEY,
  initialAiSettings,
  normalizeAiSettings,
  resetPromptComposition,
  saveAiSettings,
  withPromptSystemPrompt,
} from '../src/ai-settings.ts'

test('customized legacy prompts migrate losslessly to PromptComposition system prompts', () => {
  const migrated = normalizeAiSettings({ prompts: {
    story: 'custom story {{scene.text}}', summarize: 'custom summary', lore: 'custom lore', assistant: 'custom assistant',
  } })
  assert.equal(migrated.promptCompositionVersion, 1)
  assert.equal(migrated.promptCompositions.story.systemPrompt, 'custom story {{scene.text}}')
  assert.equal(migrated.promptCompositions.assistant.systemPrompt, 'custom assistant')
  assert.deepEqual(migrated.promptCompositions.story.predefinedMessages, [])
  assert.equal(migrated.prompts.story, migrated.promptCompositions.story.systemPrompt)
})

test('existing composition is the source of truth even when a stale legacy mirror is supplied', () => {
  const normalized = normalizeAiSettings({
    prompts: { story: 'stale', summarize: 'stale', lore: 'stale', assistant: 'stale' },
    promptCompositions: {
      ...initialAiSettings.promptCompositions,
      story: { systemPrompt: 'authoritative', predefinedMessages: [{ id: 'x', role: 'assistant', enabled: true, template: 'example' }] },
    },
  })
  assert.equal(normalized.promptCompositions.story.systemPrompt, 'authoritative')
  assert.equal(normalized.prompts.story, 'authoritative')
  assert.equal(normalized.promptCompositions.story.predefinedMessages[0].role, 'assistant')
})

test('reset changes only the selected prompt composition', () => {
  const changed = withPromptSystemPrompt({ ...initialAiSettings, responseLength: 'keep me', mainModel: 'model-a' }, 'story', 'custom')
  const reset = resetPromptComposition(changed, 'story')
  assert.notEqual(changed.promptCompositions.story.systemPrompt, reset.promptCompositions.story.systemPrompt)
  assert.equal(reset.responseLength, 'keep me')
  assert.equal(reset.mainModel, 'model-a')
  assert.deepEqual(reset.promptCompositions.assistant, changed.promptCompositions.assistant)
})

test('new persistence stores versioned compositions and omits the legacy prompts mirror', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  }
  const saved = saveAiSettings(withPromptSystemPrompt(initialAiSettings, 'story', 'persisted composition'))
  const raw = JSON.parse(values.get(AI_SETTINGS_STORAGE_KEY))
  assert.equal(raw.prompts, undefined)
  assert.equal(raw.promptCompositionVersion, 1)
  assert.equal(raw.promptCompositions.story.systemPrompt, 'persisted composition')
  assert.equal(saved.prompts.story, 'persisted composition')
})
''')
