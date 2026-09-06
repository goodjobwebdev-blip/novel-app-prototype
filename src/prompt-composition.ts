export type PromptCompositionScope = 'story' | 'summarize' | 'lore' | 'assistant'
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
