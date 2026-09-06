export type PromptCompositionScope = 'story' | 'summarize' | 'lore' | 'assistant'
export type PromptMessageRole = 'system' | 'user' | 'assistant'
export type ProviderMessageRole = PromptMessageRole | 'tool'
export type PromptOwnership = 'user-configuration' | 'app-managed' | 'conversation' | 'current-turn'
export type PromptSourceKind = 'system-prompt' | 'predefined-message' | 'app-managed' | 'history' | 'current-turn'
export type VariableStability = 'stable' | 'book-state' | 'turn-dynamic'

export type PredefinedMessage = {
  id: string
  name?: string
  role: PromptMessageRole
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

export type DynamicSourceDedupeDecision = {
  sourceId: string
  automatic: DynamicContextSource
  omittedAdditional: DynamicContextSource
  reason: 'already-represented-automatically'
}

export type ProviderToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type NormalizedProviderMessage = {
  role: ProviderMessageRole
  content: string | null
  reasoning_content?: string
  tool_calls?: ProviderToolCall[]
  tool_call_id?: string
}

export type NormalizedStructuredRequestPart = {
  id: string
  sourceKind: 'app-managed'
  sourceId?: string
  name?: string
  ownership: 'app-managed'
  value: unknown
  omitted: boolean
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
  providerMessage?: NormalizedProviderMessage
}

export type NormalizedAssembledRequest = {
  parts: NormalizedRequestPart[]
  providerMessages: NormalizedProviderMessage[]
  structuredParts: NormalizedStructuredRequestPart[]
  providerTools: Array<Record<string, unknown>>
  dynamicSourceDedupe: DynamicSourceDedupeDecision[]
}

export type RenderedTemplate = {
  content: string
  referencedVariables: string[]
}

export type PromptTemplateToken = {
  type: 'text' | 'variable' | 'if' | 'endif'
  from: number
  to: number
  raw: string
  variable?: string
}

export type PromptTemplateDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
  from: number
  to: number
  variable?: string
  suggestion?: string
}

export type ParsedPromptTemplate = {
  tokens: PromptTemplateToken[]
  diagnostics: PromptTemplateDiagnostic[]
}

export type PromptTemplateVariableDefinition = {
  name: string
  scopes: string[]
}

export type ProviderRoleSupport = Partial<Record<ProviderMessageRole, boolean>>

const VARIABLE_EXPRESSION = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/
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

function syntaxDiagnostic(code: string, message: string, from: number, to: number): PromptTemplateDiagnostic {
  return { severity: 'error', code, message, from, to: Math.max(from + 1, to) }
}

/** Tokenize Arc's deliberately small template language and report structural errors. */
export function parsePromptTemplate(template: string): ParsedPromptTemplate {
  const tokens: PromptTemplateToken[] = []
  const diagnostics: PromptTemplateDiagnostic[] = []
  const conditionStack: PromptTemplateToken[] = []
  let cursor = 0

  const pushText = (from: number, to: number) => {
    if (to > from) tokens.push({ type: 'text', from, to, raw: template.slice(from, to) })
  }

  while (cursor < template.length) {
    const candidates = [
      { index: template.indexOf('{{', cursor), kind: 'variable' as const },
      { index: template.indexOf('{%', cursor), kind: 'control' as const },
      { index: template.indexOf('}}', cursor), kind: 'variable-close' as const },
      { index: template.indexOf('%}', cursor), kind: 'control-close' as const },
    ].filter((candidate) => candidate.index >= 0).sort((left, right) => left.index - right.index)
    const next = candidates[0]
    if (!next) {
      pushText(cursor, template.length)
      break
    }

    pushText(cursor, next.index)
    if (next.kind === 'variable-close' || next.kind === 'control-close') {
      diagnostics.push(syntaxDiagnostic(
        next.kind === 'variable-close' ? 'unexpected-variable-close' : 'unexpected-control-close',
        `Unexpected ${next.kind === 'variable-close' ? '}}' : '%}'} closing delimiter.`,
        next.index,
        next.index + 2,
      ))
      pushText(next.index, next.index + 2)
      cursor = next.index + 2
      continue
    }

    const close = next.kind === 'variable' ? '}}' : '%}'
    const closeIndex = template.indexOf(close, next.index + 2)
    if (closeIndex < 0) {
      diagnostics.push(syntaxDiagnostic(
        next.kind === 'variable' ? 'unclosed-variable' : 'unclosed-control',
        `Unclosed ${next.kind === 'variable' ? '{{ variable' : '{% control'} delimiter.`,
        next.index,
        template.length,
      ))
      pushText(next.index, template.length)
      break
    }

    const to = closeIndex + 2
    const raw = template.slice(next.index, to)
    const expression = template.slice(next.index + 2, closeIndex).trim()
    if (next.kind === 'variable') {
      const token: PromptTemplateToken = { type: 'variable', from: next.index, to, raw, variable: expression }
      tokens.push(token)
      if (!VARIABLE_EXPRESSION.test(expression)) {
        diagnostics.push({
          ...syntaxDiagnostic('malformed-variable', expression ? `Malformed variable expression “${expression}”.` : 'Variable name cannot be empty.', next.index, to),
          ...(expression ? { variable: expression } : {}),
        })
      }
    } else if (expression === 'endif') {
      const token: PromptTemplateToken = { type: 'endif', from: next.index, to, raw }
      tokens.push(token)
      if (!conditionStack.length) {
        diagnostics.push(syntaxDiagnostic('unexpected-endif', 'Unexpected {% endif %}; there is no open conditional block.', next.index, to))
      } else {
        conditionStack.pop()
      }
    } else {
      const match = expression.match(/^if\s+(.+)$/)
      if (!match) {
        tokens.push({ type: 'text', from: next.index, to, raw })
        diagnostics.push(syntaxDiagnostic('unsupported-control', `Unsupported template tag “${raw}”. Arc supports only {% if variable %} and {% endif %}.`, next.index, to))
      } else {
        const variable = match[1].trim()
        const token: PromptTemplateToken = { type: 'if', from: next.index, to, raw, variable }
        tokens.push(token)
        if (!VARIABLE_EXPRESSION.test(variable)) {
          diagnostics.push({
            ...syntaxDiagnostic('malformed-condition', variable ? `Malformed conditional variable “${variable}”.` : 'Conditional variable cannot be empty.', next.index, to),
            ...(variable ? { variable } : {}),
          })
        }
        if (conditionStack.length) {
          diagnostics.push(syntaxDiagnostic('nested-condition', 'Nested conditional blocks are not supported.', next.index, to))
        }
        conditionStack.push(token)
      }
    }
    cursor = to
  }

  for (const token of conditionStack) {
    diagnostics.push(syntaxDiagnostic('unclosed-condition', `Conditional for “${token.variable ?? ''}” is missing {% endif %}.`, token.from, token.to))
  }
  return { tokens, diagnostics }
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function nearestVariable(name: string, variables: PromptTemplateVariableDefinition[]) {
  const ranked = variables.map((variable) => ({ candidate: variable.name, distance: editDistance(name, variable.name) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
  const nearest = ranked[0]
  return nearest && nearest.distance <= Math.max(2, Math.floor(name.length / 3)) ? nearest.candidate : undefined
}

/** Add catalog, scope, and current-value diagnostics to the shared syntax parse. */
export function validatePromptTemplate(input: {
  template: string
  variables: PromptTemplateVariableDefinition[]
  scope: string
  values?: Record<string, string>
}): PromptTemplateDiagnostic[] {
  const parsed = parsePromptTemplate(input.template)
  const diagnostics = [...parsed.diagnostics]
  const normalizedValues = input.values ? withLegacyVariableAliases(input.values) : undefined

  for (const token of parsed.tokens) {
    if ((token.type !== 'variable' && token.type !== 'if') || !token.variable || !VARIABLE_EXPRESSION.test(token.variable)) continue
    const variable = input.variables.find((candidate) => candidate.name === token.variable)
    if (!variable) {
      const suggestion = nearestVariable(token.variable, input.variables)
      diagnostics.push({
        severity: 'error',
        code: 'unknown-variable',
        message: `Unknown variable “${token.variable}”.${suggestion ? ` Did you mean {{${suggestion}}}?` : ''}`,
        from: token.from,
        to: token.to,
        variable: token.variable,
        ...(suggestion ? { suggestion } : {}),
      })
      continue
    }
    if (!variable.scopes.includes(input.scope)) {
      diagnostics.push({
        severity: 'error',
        code: 'out-of-scope-variable',
        message: `{{${token.variable}}} is not available in ${input.scope} prompts.`,
        from: token.from,
        to: token.to,
        variable: token.variable,
      })
      continue
    }
    const canonical = canonicalVariableName(token.variable)
    if (normalizedValues && Object.prototype.hasOwnProperty.call(normalizedValues, canonical) && !normalizedValues[canonical]?.trim()) {
      diagnostics.push({
        severity: 'warning',
        code: 'empty-preview-value',
        message: `{{${token.variable}}} is empty in the current preview.`,
        from: token.from,
        to: token.to,
        variable: token.variable,
      })
    }
  }
  return diagnostics.sort((left, right) => left.from - right.from || (left.severity === 'error' ? -1 : 1))
}

export function referencedVariables(template: string) {
  const names: string[] = []
  const seen = new Set<string>()
  for (const token of parsePromptTemplate(template).tokens) {
    if ((token.type === 'variable' || token.type === 'if') && token.variable && VARIABLE_EXPRESSION.test(token.variable) && !seen.has(token.variable)) {
      seen.add(token.variable)
      names.push(token.variable)
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
  const parsed = parsePromptTemplate(template)
  const references = referencedVariables(template)
  const included: boolean[] = []
  let content = ''
  for (const token of parsed.tokens) {
    if (token.type === 'if') {
      included.push(Boolean(token.variable && normalizedValues[token.variable]?.trim()))
    } else if (token.type === 'endif') {
      included.pop()
    } else if (included.every(Boolean)) {
      content += token.type === 'variable' && token.variable && VARIABLE_EXPRESSION.test(token.variable)
        ? normalizedValues[token.variable] ?? ''
        : token.raw
    }
  }
  return { content: content.replace(/\n{3,}/g, '\n\n').trim(), referencedVariables: references }
}

export function dedupeAdditionalSources(automatic: DynamicContextSource[], additional: DynamicContextSource[]) {
  return dedupeDynamicSources(automatic, additional).additional
}

export function dedupeDynamicSources(automatic: DynamicContextSource[], additional: DynamicContextSource[]) {
  const automaticById = new Map(automatic.map((source) => [source.sourceId, source]))
  const decisions: DynamicSourceDedupeDecision[] = []
  const deduplicatedAdditional = additional.filter((source) => {
    const automaticSource = automaticById.get(source.sourceId)
    if (!automaticSource) return true
    decisions.push({ sourceId: source.sourceId, automatic: { ...automaticSource }, omittedAdditional: { ...source }, reason: 'already-represented-automatically' })
    return false
  })
  return {
    automatic: automatic.map((source) => ({ ...source })),
    additional: deduplicatedAdditional.map((source) => ({ ...source })),
    decisions,
  }
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
  providerMessage?: NormalizedProviderMessage
}): NormalizedRequestPart {
  return {
    ...part,
    referencedVariables: part.referencedVariables ?? [],
    enabled: true,
    omitted: !part.content.trim() && !part.providerMessage?.tool_calls?.length && !part.providerMessage?.tool_call_id,
  }
}

export function normalizeRuntimeMessagePart(input: {
  id: string
  sourceKind: 'app-managed' | 'history' | 'current-turn'
  sourceId?: string
  name?: string
  ownership: 'app-managed' | 'conversation' | 'current-turn'
  message: NormalizedProviderMessage
}): NormalizedRequestPart {
  return normalizeAppManagedPart({
    id: input.id,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    name: input.name,
    ownership: input.ownership,
    role: input.message.role,
    content: input.message.content ?? '',
    providerMessage: cloneProviderMessage(input.message),
  })
}

function cloneProviderMessage(message: NormalizedProviderMessage): NormalizedProviderMessage {
  return {
    ...message,
    ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call) => ({ ...call, function: { ...call.function } })) } : {}),
  }
}

function cloneStructuredValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneStructuredValue(item)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneStructuredValue(item)])) as T
  return value
}

export function normalizeStructuredTools(tools: Array<Record<string, unknown>>): NormalizedStructuredRequestPart {
  return {
    id: 'provider-tools',
    sourceKind: 'app-managed',
    sourceId: 'provider-tools',
    name: 'Provider tool definitions',
    ownership: 'app-managed',
    value: tools.map((tool) => cloneStructuredValue(tool)),
    omitted: tools.length === 0,
  }
}

export function assembleNormalizedRequest(parts: NormalizedRequestPart[], options: {
  structuredParts?: NormalizedStructuredRequestPart[]
  dynamicSourceDedupe?: DynamicSourceDedupeDecision[]
} = {}): NormalizedAssembledRequest {
  const providerMessages = parts.flatMap((part) => !part.omitted && part.role
    ? [part.providerMessage ? cloneProviderMessage(part.providerMessage) : { role: part.role, content: part.content }]
    : [])
  const structuredParts = (options.structuredParts ?? []).map((part) => ({ ...part, value: cloneStructuredValue(part.value) }))
  const providerTools = structuredParts.flatMap((part) => part.id === 'provider-tools' && !part.omitted && Array.isArray(part.value)
    ? part.value as Array<Record<string, unknown>>
    : [])
  return {
    parts,
    providerMessages,
    structuredParts,
    providerTools: providerTools.map((tool) => cloneStructuredValue(tool)),
    dynamicSourceDedupe: (options.dynamicSourceDedupe ?? []).map((decision) => ({
      ...decision,
      automatic: { ...decision.automatic },
      omittedAdditional: { ...decision.omittedAdditional },
    })),
  }
}

export function assembleCompositionRequest(input: {
  composition: PromptComposition
  values: Record<string, string>
  dynamicSources?: Record<string, DynamicContextSource[]>
  after?: NormalizedRequestPart[]
  structuredParts?: NormalizedStructuredRequestPart[]
  dynamicSourceDedupe?: DynamicSourceDedupeDecision[]
}): NormalizedAssembledRequest {
  return assembleNormalizedRequest([
    ...renderPromptComposition(input.composition, input.values, input.dynamicSources),
    ...(input.after ?? []),
  ], { structuredParts: input.structuredParts, dynamicSourceDedupe: input.dynamicSourceDedupe })
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
  return request.providerMessages.map(cloneProviderMessage)
}

export function normalizedRequestDiagnosticText(request: NormalizedAssembledRequest) {
  return JSON.stringify({ messages: request.providerMessages, ...(request.providerTools.length ? { tools: request.providerTools } : {}) })
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
