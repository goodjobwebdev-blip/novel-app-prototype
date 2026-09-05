import type { AiSettings } from './ai-settings'
import type { PreparedContextValues } from './context-service'
import type { ArcEntity, GenerationContextType } from './persistence'
import { bookTemplateValues, renderPromptTemplate, type BookPromptValues } from './prompt-template'

export type ContextPreviewSection = {
  title: string
  detail: string
  content: string
}

export type ContextPreviewResult = {
  sections: ContextPreviewSection[]
  combinedText: string
  scopeLabel: string
  helperText: string
}

type ContextPreviewOptions = {
  type: GenerationContextType
  aiSettings: AiSettings
  metadata: BookPromptValues
  prepared: PreparedContextValues
  sources: ArcEntity[]
  currentDocumentId?: string
  currentDocumentText?: string
  chatId?: string
}

const CHAT_WORKSPACE_INSTRUCTIONS = `# Workspace tools

You can inspect and propose edits to Scenes, Notes, and Codex entries in this book. You can also propose creating a new Codex/lore entry. For the outline, use read_outline before structural changes; you may propose creating, renaming, moving/reordering, or deleting Acts, Chapters, and Scenes. Mutating tools only create approval proposals: never claim an edit, creation, rename, move, reorder, or deletion happened until the user approves the card in Chat. Outline deletion is allowed only when the target and every descendant Scene have empty content. Search/read tools are read-only and can run automatically. Use search_entities and read_entity when a document target is not already known. For localized document changes, prefer propose_document_edit with exact old_text copied from read_entity. Use propose_document_replacement only for whole-document rewrites.`

function stringValue(entity: ArcEntity | undefined, key: string) {
  const value = entity?.[key]
  return typeof value === 'string' ? value : ''
}

function numberValue(entity: ArcEntity, key: string) {
  const value = entity[key]
  return typeof value === 'number' ? value : 0
}

function section(title: string, content: string) {
  return `# ${title}\n\n${content.trim()}`
}

function proposalState(message: ArcEntity) {
  const documentEdits = Array.isArray(message.documentEdits) ? message.documentEdits as Array<Record<string, unknown>> : []
  const codexCreations = Array.isArray(message.codexCreations) ? message.codexCreations as Array<Record<string, unknown>> : []
  const outlineActions = Array.isArray(message.outlineActions) ? message.outlineActions as Array<Record<string, unknown>> : []
  const editState = documentEdits.length
    ? `\n\n[Workspace edit proposals: ${documentEdits.map((proposal) => `${String(proposal.entityTitle ?? 'Untitled')}: ${String(proposal.status ?? 'unknown')}`).join('; ')}]`
    : ''
  const creationState = codexCreations.length
    ? `\n\n[Codex creation proposals: ${codexCreations.map((proposal) => `${String(proposal.title ?? 'Untitled')}: ${String(proposal.status ?? 'unknown')}`).join('; ')}]`
    : ''
  const outlineState = outlineActions.length
    ? `\n\n[Outline proposals: ${outlineActions.map((proposal) => `${String(proposal.action ?? 'change')} ${String(proposal.entityTitle ?? 'Untitled')}: ${String(proposal.status ?? 'unknown')}`).join('; ')}]`
    : ''
  return `${editState}${creationState}${outlineState}`
}

function chatHistorySections(sources: ArcEntity[], chatId?: string): ContextPreviewSection[] {
  if (!chatId) return []
  const messages = sources
    .filter((item) => item.type === 'chatMessage' && item.parentId === chatId)
    .sort((a, b) => numberValue(a, 'order') - numberValue(b, 'order') || a.createdAt - b.createdAt)
  return messages.flatMap((message, index) => {
    const role = message.role === 'assistant' ? 'Assistant' : 'User'
    const content = `${stringValue(message, 'content')}${message.role === 'assistant' ? proposalState(message) : ''}`
    const sections: ContextPreviewSection[] = [{
      title: `${role} message ${index + 1}`,
      detail: 'Chat history',
      content,
    }]
    const thoughts = message.role === 'assistant' ? stringValue(message, 'thoughts') : ''
    if (thoughts) sections.push({
      title: `${role} reasoning ${index + 1}`,
      detail: 'Chat history',
      content: thoughts,
    })
    return sections
  })
}

function storySystemPrompt(options: ContextPreviewOptions, currentDocument: ArcEntity | undefined) {
  const values = {
    ...bookTemplateValues(options.metadata),
    'scene.text': options.prepared.currentSceneText,
    'scene.pov': stringValue(currentDocument, 'pov'),
    'scene.previous_text': options.prepared.previousSceneText,
    'scene.summary_context': options.prepared.summaryContext,
    'additional_context': options.prepared.additionalContext,
  }
  return renderPromptTemplate(options.aiSettings.prompts.story, values)
}

function loreSystemPrompt(options: ContextPreviewOptions, currentDocument: ArcEntity | undefined, currentDocumentContent: string) {
  return renderPromptTemplate(options.aiSettings.prompts.lore, {
    ...bookTemplateValues(options.metadata),
    'entry.title': currentDocument?.title ?? '',
    'entry.category': stringValue(currentDocument, 'category'),
    'entry.content': currentDocumentContent,
    'scene.text': options.prepared.lastSceneText,
    'additional_context': options.prepared.additionalContext,
  })
}

function assistantSystemPrompt(options: ContextPreviewOptions) {
  return renderPromptTemplate(options.aiSettings.prompts.assistant, bookTemplateValues(options.metadata))
}

export function buildComprehensiveContextPreview(options: ContextPreviewOptions): ContextPreviewResult {
  const currentDocument = options.sources.find((item) => item.id === options.currentDocumentId)
  const currentDocumentContent = options.currentDocumentText ?? stringValue(currentDocument, 'content')
  const activeChat = options.type === 'chat' && options.chatId
    ? options.sources.find((item) => item.type === 'chat' && item.id === options.chatId)
    : undefined

  const systemPrompt = options.type === 'scene'
    ? storySystemPrompt(options, currentDocument)
    : options.type === 'codex'
      ? loreSystemPrompt(options, currentDocument, currentDocumentContent)
      : options.type === 'chat'
        ? renderPromptTemplate(stringValue(activeChat, 'systemPrompt') || options.aiSettings.prompts.assistant, bookTemplateValues(options.metadata))
        : assistantSystemPrompt(options)

  const sections: ContextPreviewSection[] = [{
    title: options.type === 'chat' ? 'Chat system prompt' : options.type === 'scene' ? 'Story system prompt' : options.type === 'codex' ? 'Lore system prompt' : 'Assistant system prompt',
    detail: 'System',
    content: systemPrompt,
  }]

  if (options.type === 'scene') {
    if (options.prepared.previousSceneText) sections.push({
      title: `Previous scene${options.prepared.previousSceneTitle ? ` — ${options.prepared.previousSceneTitle}` : ''}`,
      detail: 'Empty-scene fallback',
      content: options.prepared.previousSceneText,
    })
    if (options.prepared.summaryContext) sections.push({ title: 'Earlier summaries', detail: 'Automatic', content: options.prepared.summaryContext })
    if (options.prepared.additionalContext) sections.push({ title: 'Additional context', detail: 'Selected', content: options.prepared.additionalContext })
    sections.push({
      title: `Current scene${options.prepared.currentSceneTitle ? ` — ${options.prepared.currentSceneTitle}` : ''}`,
      detail: 'Current editor',
      content: options.prepared.currentSceneText,
    })
  } else if (options.type === 'codex') {
    sections.push({
      title: `Current entry${currentDocument?.title ? ` — ${currentDocument.title}` : ''}`,
      detail: 'Current editor',
      content: currentDocumentContent,
    })
    if (options.prepared.lastSceneText) sections.push({
      title: `Last-opened scene${options.prepared.lastSceneTitle ? ` — ${options.prepared.lastSceneTitle}` : ''}`,
      detail: 'Automatic',
      content: options.prepared.lastSceneText,
    })
    if (options.prepared.additionalContext) sections.push({ title: 'Additional context', detail: 'Selected', content: options.prepared.additionalContext })
  } else if (options.type === 'note') {
    sections.push({
      title: `Current note${currentDocument?.title ? ` — ${currentDocument.title}` : ''}`,
      detail: 'Current editor',
      content: currentDocumentContent,
    })
    if (options.prepared.additionalContext) sections.push({ title: 'Additional context', detail: 'Selected', content: options.prepared.additionalContext })
  } else {
    sections.push({ title: 'Workspace tool instructions', detail: 'System', content: CHAT_WORKSPACE_INSTRUCTIONS })
    const selectedContext = [
      options.prepared.lastSceneText ? section(`Current scene${options.prepared.lastSceneTitle ? ` — ${options.prepared.lastSceneTitle}` : ''}`, options.prepared.lastSceneText) : '',
      options.prepared.additionalContext ? section('Additional context', options.prepared.additionalContext) : '',
    ].filter(Boolean).join('\n\n')
    if (selectedContext) sections.push({ title: 'Selected book context', detail: 'System', content: selectedContext })
    sections.push(...chatHistorySections(options.sources, options.chatId))
  }

  const scopeLabel = options.type === 'scene' ? 'Story' : options.type === 'codex' ? 'Codex' : options.type === 'note' ? 'Note' : 'Chat'
  const helperText = options.type === 'chat'
    ? 'Shows the current chat system prompt, workspace instructions, selected book context, and saved conversation history. The next unsent composer message appears only after you send it.'
    : options.type === 'note'
      ? 'Shows the Assistant system prompt together with the current Note and the context selected for Note generation.'
      : 'Shows the rendered system prompt together with the automatic and selected context available to this generation type. The Arc instruction is added only when you generate.'
  const combinedText = sections.map((item) => `# ${item.title} [${item.detail}]\n\n${item.content || '[empty]'}`).join('\n\n')

  return { sections, combinedText, scopeLabel, helperText }
}
