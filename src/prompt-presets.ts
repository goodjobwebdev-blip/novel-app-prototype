import { promptTemplateDiagnostics } from './prompt-template.ts'
import type { PredefinedMessage, PromptComposition, PromptCompositionScope, PromptMessageRole } from './prompt-composition.ts'

export const PROMPT_PRESET_STORAGE_KEY = 'arc-prompt-composition-presets-v1'
export const PROMPT_PRESET_SCHEMA_VERSION = 1

export type PromptPresetScope = 'story' | 'chat' | 'codex' | 'summary'
export type PromptPresetMessage = Pick<PredefinedMessage, 'name' | 'role' | 'enabled' | 'template'>
export type PromptCompositionPreset = {
  id: string
  kind: 'built-in' | 'user'
  scope: PromptPresetScope
  name: string
  systemPrompt: string
  predefinedMessages: PromptPresetMessage[]
  createdAt?: number
  updatedAt?: number
}

type StoredPromptPresets = {
  version: typeof PROMPT_PRESET_SCHEMA_VERSION
  presets: PromptCompositionPreset[]
}

const promptScopeByPresetScope: Record<PromptPresetScope, PromptCompositionScope> = {
  story: 'story',
  chat: 'assistant',
  codex: 'lore',
  summary: 'summarize',
}

function cloneMessages(messages: PromptPresetMessage[]): PromptPresetMessage[] {
  return messages.map((message) => ({
    ...(message.name === undefined ? {} : { name: message.name }),
    role: message.role,
    enabled: message.enabled,
    template: message.template,
  }))
}

function compositionMessages(composition: PromptComposition): PromptPresetMessage[] {
  return composition.predefinedMessages.map(({ name, role, enabled, template }) => ({
    ...(name === undefined ? {} : { name }),
    role,
    enabled,
    template,
  }))
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `prompt-preset-${crypto.randomUUID()}`
    : `prompt-preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function storageOrDefault(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  if (storage) return storage
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function parsedUserPreset(value: unknown): PromptCompositionPreset | null {
  if (!value || typeof value !== 'object') return null
  const preset = value as Partial<PromptCompositionPreset>
  if (preset.kind !== 'user' || typeof preset.id !== 'string' || typeof preset.name !== 'string'
    || !['story', 'chat', 'codex', 'summary'].includes(String(preset.scope))
    || !Array.isArray(preset.predefinedMessages)) return null
  const messages = preset.predefinedMessages.map((value) => {
    const message = value && typeof value === 'object' ? value as Partial<PromptPresetMessage> : {}
    return {
      ...(typeof message.name === 'string' ? { name: message.name } : {}),
      role: message.role as PromptMessageRole,
      enabled: message.enabled as boolean,
      template: message.template as string,
    }
  })
  return {
    id: preset.id,
    kind: 'user',
    scope: preset.scope as PromptPresetScope,
    name: preset.name,
    systemPrompt: preset.systemPrompt as string,
    predefinedMessages: messages,
    ...(typeof preset.createdAt === 'number' ? { createdAt: preset.createdAt } : {}),
    ...(typeof preset.updatedAt === 'number' ? { updatedAt: preset.updatedAt } : {}),
  }
}

export function loadUserPromptPresets(storage?: Pick<Storage, 'getItem' | 'setItem'>): PromptCompositionPreset[] {
  const target = storageOrDefault(storage)
  if (!target) return []
  try {
    const value = JSON.parse(target.getItem(PROMPT_PRESET_STORAGE_KEY) ?? 'null') as Partial<StoredPromptPresets> | null
    if (value?.version !== PROMPT_PRESET_SCHEMA_VERSION || !Array.isArray(value.presets)) return []
    return value.presets.flatMap((preset) => parsedUserPreset(preset) ?? [])
  } catch {
    return []
  }
}

function writeUserPromptPresets(presets: PromptCompositionPreset[], storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const target = storageOrDefault(storage)
  if (!target) throw new Error('Prompt presets are unavailable in this browser.')
  const value: StoredPromptPresets = {
    version: PROMPT_PRESET_SCHEMA_VERSION,
    presets: presets.filter((preset) => preset.kind === 'user').map((preset) => ({ ...preset, predefinedMessages: cloneMessages(preset.predefinedMessages) })),
  }
  target.setItem(PROMPT_PRESET_STORAGE_KEY, JSON.stringify(value))
}

export function arcDefaultPromptPreset(scope: PromptPresetScope, composition: PromptComposition): PromptCompositionPreset {
  return Object.freeze({
    id: `arc-default:${scope}`,
    kind: 'built-in' as const,
    scope,
    name: 'Arc default',
    systemPrompt: composition.systemPrompt,
    predefinedMessages: Object.freeze(compositionMessages(composition).map((message) => Object.freeze(message))) as unknown as PromptPresetMessage[],
  })
}

export function promptPresetsForScope(scope: PromptPresetScope, arcDefault: PromptComposition, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  return [arcDefaultPromptPreset(scope, arcDefault), ...loadUserPromptPresets(storage).filter((preset) => preset.scope === scope)]
}

export function validatePromptCompositionPreset(preset: PromptCompositionPreset) {
  const errors: string[] = []
  if (!['story', 'chat', 'codex', 'summary'].includes(preset.scope)) errors.push('The preset scope is invalid.')
  if (typeof preset.name !== 'string' || !preset.name.trim()) errors.push('The preset name is empty.')
  if (typeof preset.systemPrompt !== 'string') errors.push('The System prompt is invalid.')
  if (!Array.isArray(preset.predefinedMessages)) errors.push('The predefined message list is invalid.')
  const promptScope = promptScopeByPresetScope[preset.scope]
  if (promptScope && typeof preset.systemPrompt === 'string') {
    errors.push(...promptTemplateDiagnostics(preset.systemPrompt, promptScope).filter((item) => item.severity === 'error').map((item) => `System prompt: ${item.message}`))
  }
  const messages = Array.isArray(preset.predefinedMessages) ? preset.predefinedMessages : []
  messages.forEach((message, index) => {
    if (!['system', 'user', 'assistant'].includes(message.role)) errors.push(`Message ${index + 1} has an invalid role.`)
    if (typeof message.enabled !== 'boolean') errors.push(`Message ${index + 1} has an invalid enabled state.`)
    if (typeof message.template !== 'string') errors.push(`Message ${index + 1} has an invalid template.`)
    else if (promptScope) errors.push(...promptTemplateDiagnostics(message.template, promptScope).filter((item) => item.severity === 'error').map((item) => `Message ${index + 1}: ${item.message}`))
  })
  return errors
}

export function applyPromptCompositionPreset(preset: PromptCompositionPreset): PromptComposition {
  const errors = validatePromptCompositionPreset(preset)
  if (errors.length) throw new Error(`This preset cannot be applied. ${errors.join(' ')}`)
  return {
    systemPrompt: preset.systemPrompt,
    predefinedMessages: preset.predefinedMessages.map((message) => ({ ...message, id: newId() })),
  }
}

function assertUniqueName(presets: PromptCompositionPreset[], scope: PromptPresetScope, name: string, exceptId?: string) {
  const normalized = name.trim().toLocaleLowerCase()
  if (!normalized) throw new Error('Enter a preset name.')
  if (presets.some((preset) => preset.scope === scope && preset.id !== exceptId && preset.name.trim().toLocaleLowerCase() === normalized)) {
    throw new Error(`A ${scope} preset named “${name.trim()}” already exists.`)
  }
}

export function savePromptCompositionPreset(scope: PromptPresetScope, name: string, composition: PromptComposition, options: { replaceId?: string; storage?: Pick<Storage, 'getItem' | 'setItem'> } = {}) {
  const presets = loadUserPromptPresets(options.storage)
  assertUniqueName(presets, scope, name, options.replaceId)
  const replaced = options.replaceId ? presets.find((preset) => preset.id === options.replaceId && preset.scope === scope) : undefined
  const now = Date.now()
  const next: PromptCompositionPreset = {
    id: replaced?.id ?? newId(),
    kind: 'user',
    scope,
    name: name.trim(),
    systemPrompt: composition.systemPrompt,
    predefinedMessages: compositionMessages(composition),
    createdAt: replaced?.createdAt ?? now,
    updatedAt: now,
  }
  writeUserPromptPresets(replaced ? presets.map((preset) => preset.id === replaced.id ? next : preset) : [...presets, next], options.storage)
  return next
}

export function renamePromptCompositionPreset(id: string, name: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const presets = loadUserPromptPresets(storage)
  const current = presets.find((preset) => preset.id === id)
  if (!current) throw new Error('Only user presets can be renamed.')
  assertUniqueName(presets, current.scope, name, id)
  const renamed = { ...current, name: name.trim(), updatedAt: Date.now() }
  writeUserPromptPresets(presets.map((preset) => preset.id === id ? renamed : preset), storage)
  return renamed
}

export function duplicatePromptCompositionPreset(preset: PromptCompositionPreset, name: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  return savePromptCompositionPreset(preset.scope, name, {
    systemPrompt: preset.systemPrompt,
    predefinedMessages: preset.predefinedMessages.map((message, index) => ({ ...message, id: `preset-copy-${index + 1}` })),
  }, { storage })
}

export function deletePromptCompositionPreset(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  if (id.startsWith('arc-default:')) throw new Error('Arc default presets cannot be deleted.')
  const presets = loadUserPromptPresets(storage)
  if (!presets.some((preset) => preset.id === id)) throw new Error('The user preset no longer exists.')
  writeUserPromptPresets(presets.filter((preset) => preset.id !== id), storage)
}
