import { generationContextDiagnostics, type ContextDiagnostics } from './context-service'
import { fetchTextProviderModelContextLength, streamTextProviderCompletion } from './text-provider'
import type { AiSettings } from './ai-settings'
import {
  getEntity,
  isCodexEntryArchived,
  listEntitiesByBook,
  type ArcEntity,
  type BookEntity,
  type CodexEntryEntity,
  type NoteEntity,
  type StructuralEntity,
} from './persistence'
import { buildSummarySource, summaryStateForSource } from './summary-service'

export type AutotitleTargetType = 'book' | 'act' | 'chapter' | 'scene' | 'note' | 'codexEntry'
export type AutotitleEntity = BookEntity | StructuralEntity | NoteEntity | CodexEntryEntity

export type AutotitleRequest = {
  targetId: string
  targetType: AutotitleTargetType
  targetTitle: string
  expectedUpdatedAt: number
  model: string
  modelContextLength?: number
  effectiveContextLimit: string
  systemPrompt: string
  userMessage: string
  context: string
  diagnostics: ContextDiagnostics
}

const supportedTypes = new Set<AutotitleTargetType>(['book', 'act', 'chapter', 'scene', 'note', 'codexEntry'])
const structuralTypes = new Set(['act', 'chapter', 'scene'])

function isSupported(entity: ArcEntity | undefined): entity is AutotitleEntity {
  return Boolean(entity && supportedTypes.has(entity.type as AutotitleTargetType))
}

function sorted<T extends ArcEntity>(items: T[]) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function bookMeta(book: BookEntity) {
  const lines = [
    `Current book title: ${book.title}`,
    typeof book.overview === 'string' && book.overview.trim() ? `Overview: ${book.overview.trim()}` : '',
    typeof book.genre === 'string' && book.genre.trim() ? `Genre: ${book.genre.trim()}` : '',
    typeof book.writingStyle === 'string' && book.writingStyle.trim() ? `Style: ${book.writingStyle.trim()}` : '',
    typeof book.pointOfView === 'string' && book.pointOfView.trim() ? `POV: ${book.pointOfView.trim()}` : '',
    typeof book.tense === 'string' && book.tense.trim() ? `Tense: ${book.tense.trim()}` : '',
    typeof book.language === 'string' && book.language.trim() ? `Language: ${book.language.trim()}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function outlineTitles(bookId: string, entities: ArcEntity[]) {
  const structural = entities.filter((entity): entity is StructuralEntity => structuralTypes.has(entity.type) && entity.bookId === bookId)
  const lines: string[] = []
  const visit = (parentId: string, depth: number) => {
    sorted(structural.filter((entity) => entity.parentId === parentId)).forEach((entity) => {
      lines.push(`${'  '.repeat(depth)}- ${entity.type}: ${entity.title}`)
      if (entity.type !== 'scene') visit(entity.id, depth + 1)
    })
  }
  visit(bookId, 0)
  return lines.join('\n') || '_No outline titles yet._'
}

function summaryFor(source: StructuralEntity, entities: ArcEntity[]) {
  const state = summaryStateForSource(source, entities)
  if (state !== 'current') return ''
  const summary = entities.find((entity) => entity.type === 'summary' && entity.sourceEntityId === source.id)
  return summary?.content?.trim() || ''
}

async function structuralSource(source: StructuralEntity, entities: ArcEntity[]) {
  const currentSummary = summaryFor(source, entities)
  if (currentSummary) return currentSummary
  return (await buildSummarySource(source.id)).content
}

function sameLevelSiblings(target: StructuralEntity, entities: ArcEntity[]) {
  return sorted(entities.filter((entity): entity is StructuralEntity => entity.type === target.type && entity.parentId === target.parentId && entity.id !== target.id))
    .map((entity) => entity.title)
    .join(' · ') || '_No sibling titles yet._'
}

function orderedScenes(bookId: string, entities: ArcEntity[]) {
  const structural = entities.filter((entity): entity is StructuralEntity => structuralTypes.has(entity.type) && entity.bookId === bookId)
  const result: StructuralEntity[] = []
  const visit = (parentId: string) => {
    sorted(structural.filter((entity) => entity.parentId === parentId)).forEach((entity) => {
      if (entity.type === 'scene') result.push(entity)
      else visit(entity.id)
    })
  }
  visit(bookId)
  return result
}

async function contextForTarget(book: BookEntity, target: AutotitleEntity, entities: ArcEntity[]) {
  const meta = bookMeta(book)
  if (target.type === 'book') {
    const topLevel = sorted(entities.filter((entity): entity is StructuralEntity => (entity.type === 'act' || entity.type === 'chapter') && entity.parentId === book.id))
    const summaries = await Promise.all(topLevel.map(async (entity) => `## ${entity.type}: ${entity.title}\n\n${await structuralSource(entity, entities)}`))
    return `# Book metadata\n${meta}\n\n# Outline titles\n${outlineTitles(book.id, entities)}\n\n# High-level story state\n${summaries.join('\n\n') || '_No story material yet._'}`
  }
  if (target.type === 'act') {
    return `# Book metadata\n${meta}\n\n# Act\n${await structuralSource(target, entities)}\n\n# Sibling Act titles\n${sameLevelSiblings(target, entities)}`
  }
  if (target.type === 'chapter') {
    const parent = entities.find((entity): entity is StructuralEntity => entity.id === target.parentId && entity.type === 'act')
    const actContext = parent ? summaryFor(parent, entities) || parent.title : '_No parent Act._'
    return `# Book metadata\n${meta}\n\n# Chapter\n${await structuralSource(target, entities)}\n\n# Parent Act context\n${actContext}\n\n# Sibling Chapter titles\n${sameLevelSiblings(target, entities)}`
  }
  if (target.type === 'scene') {
    const chapter = entities.find((entity): entity is StructuralEntity => entity.id === target.parentId && entity.type === 'chapter')
    const scenes = orderedScenes(book.id, entities)
    const index = scenes.findIndex((scene) => scene.id === target.id)
    const previous = index > 0 ? scenes[index - 1] : undefined
    const previousState = previous ? summaryFor(previous, entities) || String(previous.content ?? '').trim() : '_No previous Scene._'
    const chapterContext = chapter ? summaryFor(chapter, entities) || chapter.title : '_No parent Chapter._'
    return `# Book metadata\n${meta}\n\n# Scene text\n${String(target.content ?? '').trim() || '_Scene is empty._'}\n\n# Chapter context\n${chapterContext}\n\n# Previous story state\n${previousState}\n\n# Sibling Scene titles\n${sameLevelSiblings(target, entities)}`
  }
  if (target.type === 'note') {
    return `# Book metadata\n${meta}\n\n# Note body\n${String(target.content ?? '').trim() || '_Note is empty._'}`
  }
  return `# Book metadata\n${meta}\n\n# Codex category\n${target.category}\n\n# Authoritative Codex body\n${String(target.content ?? '').trim() || '_Codex entry is empty._'}`
}

function goalFor(type: AutotitleTargetType) {
  if (type === 'book') return 'Name the manuscript as a whole from its established premise and story state. Do not overfit to one scene.'
  if (type === 'act') return 'Name this story movement from its established content and role in the book.'
  if (type === 'chapter') return 'Name this chapter from its actual scenes and current story state.'
  if (type === 'scene') return 'Name what happens in this specific scene. Do not invent events merely to justify the title.'
  if (type === 'note') return 'Produce a concise descriptive working title from the note contents.'
  return 'Produce an appropriate canonical name/title for this lore entity from its category and authoritative content.'
}

function systemPromptFor(type: AutotitleTargetType, language: string) {
  return `You generate exactly one ${type === 'codexEntry' ? 'Codex name/title' : `${type} title`} for a novel-writing workspace.\n\n${goalFor(type)}\n\nExisting written content outranks speculative context. For an empty structural entity, name the planned/next unit from established surrounding state without pretending nonexistent prose already happened.\n\nReturn exactly one title/name as plain text only. No Markdown, numbering, alternatives, commentary, explanation, or reasoning. Do not add quotation marks unless they are genuinely part of the title.${language.trim() ? `\n\nUse ${language.trim()} unless the established naming style clearly requires otherwise.` : ''}`
}

function parseSuggestion(output: string) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length !== 1) throw new Error('The model returned more than one title. Regenerate to get a single suggestion.')
  const value = lines[0]
  if (!value) throw new Error('The model returned an empty title.')
  if (/^(?:[-*#]|\d+[.)]\s)/.test(value) || /^(?:title|name)\s*:/i.test(value)) throw new Error('The model did not return a plain title. Regenerate to try again.')
  if (value.length > 180) throw new Error('The generated title is unexpectedly long. Regenerate to try again.')
  return value
}

export async function prepareAutotitleRequest(bookId: string, targetId: string, settings: AiSettings): Promise<AutotitleRequest> {
  if (settings.provider !== 'nanogpt' && settings.provider !== 'fake') throw new Error('Dedicated autotitle supports NanoGPT or Fake (testing). Choose one in Book AI settings.')
  if (settings.provider === 'nanogpt' && !settings.apiKey.trim()) throw new Error('Add your NanoGPT API key in Book AI settings before generating a title.')
  const [bookEntity, targetEntity, entities] = await Promise.all([
    getEntity<ArcEntity>(bookId),
    getEntity<ArcEntity>(targetId),
    listEntitiesByBook(bookId),
  ])
  if (!bookEntity || bookEntity.type !== 'book') throw new Error('The current book is no longer available.')
  if (!isSupported(targetEntity) || (targetEntity.type !== 'book' && targetEntity.bookId !== bookId) || (targetEntity.type === 'book' && targetEntity.id !== bookId)) {
    throw new Error('That item cannot be autotitled in this book.')
  }
  if (targetEntity.type === 'codexEntry' && isCodexEntryArchived(targetEntity)) {
    throw new Error('Restore this archived Codex entry before generating a title.')
  }
  const model = settings.supportModel.trim() || settings.mainModel.trim()
  if (!model) throw new Error('Choose a Support or Main model in Book AI settings before generating a title.')
  const usingSupport = Boolean(settings.supportModel.trim())
  let modelContextLength = usingSupport ? settings.supportModelContextLength : settings.mainModelContextLength
  if (!modelContextLength) {
    modelContextLength = await fetchTextProviderModelContextLength({ provider: settings.provider, apiKey: settings.apiKey.trim(), baseUrl: settings.baseUrl, model }).catch(() => undefined)
  }
  const context = await contextForTarget(bookEntity as BookEntity, targetEntity, entities)
  const language = typeof bookEntity.language === 'string' ? bookEntity.language : ''
  const systemPrompt = systemPromptFor(targetEntity.type as AutotitleTargetType, language)
  const userMessage = `# Target\n${targetEntity.type}: ${targetEntity.title}\n\n# Automatic context\n${context}\n\nReturn one suitable title/name.`
  const effectiveContextLimit = usingSupport ? '' : settings.mainEffectiveContextLimit
  const diagnostics = generationContextDiagnostics(model, modelContextLength, effectiveContextLimit, JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }] }))
  if (!diagnostics.limitValid) throw new Error(diagnostics.limitError ?? 'The effective context cap is invalid.')
  if (!diagnostics.fits) throw new Error(`Autotitle context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable budget. Arc will not trim or substitute context automatically.`)
  return {
    targetId: targetEntity.id,
    targetType: targetEntity.type as AutotitleTargetType,
    targetTitle: String(targetEntity.title ?? 'Untitled'),
    expectedUpdatedAt: targetEntity.updatedAt,
    model,
    modelContextLength,
    effectiveContextLimit,
    systemPrompt,
    userMessage,
    context,
    diagnostics,
  }
}

export async function generateAutotitleSuggestion(settings: AiSettings, request: AutotitleRequest, signal: AbortSignal) {
  let output = ''
  await streamTextProviderCompletion({
    provider: settings.provider,
    task: 'autotitle',
    apiKey: settings.apiKey.trim(),
    baseUrl: settings.baseUrl,
    model: request.model,
    systemPrompt: request.systemPrompt,
    userMessage: request.userMessage,
  }, (chunk) => { output += chunk }, signal)
  return parseSuggestion(output)
}
