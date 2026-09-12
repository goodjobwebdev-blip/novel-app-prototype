import { database, isCodexEntryArchived, listEntitiesByBook, type CodexEntryEntity } from './persistence'
import { createChat, getChat, type ChatEntity, type ChatMessageEntity } from './chat-service'
import { compareStoryPositions, resolveCodexState, timelineScenes, type StoryCutoff, type TimelineWorld } from './codex-timeline'
import { readTimelineWorld } from './codex-timeline-service'
import { proseText } from './document-projection'
import type { ChatToolCall, ChatToolDefinition } from './chat-api'
import type { PromptComposition } from './prompt-composition'
import type { PreparedContextValues } from './context-service'

export type CharacterParticipant = { entryId: string; label: string; token: string }
export type CharacterChatConfig = { sessionId: string; participants: CharacterParticipant[]; cutoff: StoryCutoff }
export type CharacterBoundary = { cutoff: StoryCutoff; fingerprint: string; sessionId: string }
export type CharacterSource = { id: string; kind: 'scene' | 'codex'; content: string }
export type CharacterFrame = { boundary: CharacterBoundary; sources: CharacterSource[]; context: PreparedContextValues; instructions: string }
export const characterPromptComposition: PromptComposition = { systemPrompt: 'Roleplay the selected characters at the supplied story position. Stay in character, distinguish uncertainty, and write dialogue naturally. Use only the selected speaker labels.', predefinedMessages: [{ id: 'character-context', name: 'Allowed story context', role: 'system', enabled: true, template: '{{context.automatic}}' }] }
export const characterReadTools: ChatToolDefinition[] = [
  { type: 'function', function: { name: 'read_story_context', description: 'Read one source from the captured character-chat boundary by its opaque ID. Only eligible prose is available.', parameters: { type: 'object', properties: { source_id: { type: 'string' } }, required: ['source_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'search_story_context', description: 'Search only the captured prior manuscript and eligible Codex states. No future sources, Notes, skills or unversioned metadata are available.', parameters: { type: 'object', properties: { query: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['query'], additionalProperties: false } } },
]
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
export const opaqueCharacterId = async (id: string) => `source-${(await hash(id)).slice(0, 24)}`
export async function listCharacterCandidates(bookId: string) { return (await listEntitiesByBook(bookId, 'codexEntry')).filter((entry): entry is CodexEntryEntity => !isCodexEntryArchived(entry) && (entry.typeId === 'lore-character' || entry.roleplayParticipant === true)) }
async function validateParticipants(bookId: string, participants: Array<{ entryId: string; label: string }>) {
  const available = await listCharacterCandidates(bookId), seen = new Set<string>(), labels = new Set<string>()
  if (!participants.length || participants.length > 8) throw new Error('Choose one to eight roleplay participants.')
  const result: CharacterParticipant[] = []
  for (const item of participants) {
    const label = item.label.trim()
    if (!available.some(entry => entry.id === item.entryId) || seen.has(item.entryId) || !label || label.length > 100 || /[\r\n:@\[\]]/.test(label) || labels.has(label.toLocaleLowerCase())) throw new Error('Choose distinct available participants and unique display labels (no @, colon, brackets or line breaks).')
    seen.add(item.entryId); labels.add(label.toLocaleLowerCase()); result.push({ entryId: item.entryId, label, token: `speaker-${(await hash(item.entryId)).slice(0, 16)}` })
  }
  return result
}
function validCutoff(cutoff: StoryCutoff, world: TimelineWorld, bookId: string) {
  const scene = timelineScenes(world, bookId).find(scene => scene.id === cutoff.sceneId)
  if (cutoff.bookId !== bookId || !scene || !Number.isInteger(cutoff.position) || cutoff.position! < 0 || cutoff.position! > String(scene.content ?? '').length) throw new Error('Choose an existing scene and a position within its current text.')
}
export async function createCharacterChat(bookId: string, participants: Array<{ entryId: string; label: string }>, cutoff: StoryCutoff, composition = characterPromptComposition) {
  const validated = await validateParticipants(bookId, participants), world = await readTimelineWorld(bookId)
  validCutoff(cutoff, world, bookId)
  const created = await createChat(bookId, `Character chat · ${validated.map(p => p.label).join(', ')}`)
  const config: CharacterChatConfig = { sessionId: crypto.randomUUID(), participants: validated, cutoff: { ...cutoff } }
  const db = await database()
  await db.table('entities').update(created.id, { character: config, promptComposition: structuredClone(composition), skillNoteIds: [], contextProfile: { includeLastScene: false, includePreviousSceneWhenEmpty: false, structuralIds: [], noteIds: [], codexEntryIds: [], summaryRange: 'none' } })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-chat-changed', { detail: { bookId } }))
  return (await getChat(created.id))!
}
export async function moveCharacterChat(chatId: string, cutoff: StoryCutoff, restart = false) {
  const chat = await getChat(chatId)
  if (!chat?.character) throw new Error('This is not a character chat.')
  const world = await readTimelineWorld(chat.bookId); validCutoff(cutoff, world, chat.bookId)
  if (restart || compareStoryPositions(cutoff, chat.character.cutoff, world) < 0) return createCharacterChat(chat.bookId, chat.character.participants, cutoff, chat.promptComposition)
  const db = await database()
  await db.transaction('rw', db.table('entities'), async () => {
    const current = await db.table('entities').get(chatId) as ChatEntity | undefined
    if (!current || JSON.stringify(current.character) !== JSON.stringify(chat.character)) throw new Error('The character chat changed. Reopen its position settings.')
    await db.table('entities').update(chatId, { character: { ...chat.character, cutoff: { ...cutoff } }, updatedAt: Date.now() })
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-chat-changed', { detail: { bookId: chat.bookId } }))
  return (await getChat(chatId))!
}
async function frameFor(config: CharacterChatConfig, entries: CodexEntryEntity[], world: TimelineWorld): Promise<CharacterFrame> {
  validCutoff(config.cutoff, world, config.cutoff.bookId)
  const scenes = timelineScenes(world, config.cutoff.bookId), index = scenes.findIndex(scene => scene.id === config.cutoff.sceneId)
  const sources: CharacterSource[] = []
  for (const scene of scenes.slice(0, index + 1)) sources.push({ id: await opaqueCharacterId(scene.id), kind: 'scene', content: proseText(String(scene.content ?? '').slice(0, scene.id === config.cutoff.sceneId ? config.cutoff.position : undefined)) })
  const lore = new Map<string, { source: CharacterSource; summary?: string }>()
  for (const entry of entries.filter(entry => !isCodexEntryArchived(entry))) {
    const state = resolveCodexState(entry, config.cutoff, world, 'strict')
    const source: CharacterSource = { id: await opaqueCharacterId(entry.id), kind: 'codex', content: state.content }
    sources.push(source); lore.set(entry.id, { source, summary: state.summary })
  }
  for (const participant of config.participants) if (!lore.has(participant.entryId)) throw new Error('A selected participant is unavailable. Start a new character chat with available entries.')
  const fingerprint = await hash(JSON.stringify(sources))
  const current = sources.filter(source => source.kind === 'scene').at(-1)!
  const prior = sources.filter(source => source.kind === 'scene').slice(0, -1)
  const selected = config.participants.map(participant => lore.get(participant.entryId)!)
  const automaticCodexContext = selected.map(item => `${item.source.id}\n${item.summary ?? item.source.content}`).join('\n\n')
  const context: PreparedContextValues = { currentSceneId: current.id, currentSceneText: current.content, currentSceneTitle: '', previousSceneId: '', previousSceneText: '', previousSceneTitle: '', summaryContext: prior.map(source => `${source.id}\n${source.content}`).join('\n\n'), lastSceneText: '', lastSceneTitle: '', additionalContext: '', codexRepresentations: [], automaticCodex: [], automaticCodexContext,
    storySoFarSources: prior.map(source => ({ sourceId: source.id, content: source.content, type: 'scene', representation: 'Allowed prior prose' })), automaticSources: selected.map(item => ({ sourceId: item.source.id, content: item.summary ?? item.source.content, type: 'codex', representation: 'Eligible body only' })) }
  const speakers = await Promise.all(config.participants.map(async p => ({ token: p.token, label: p.label, source_id: await opaqueCharacterId(p.entryId) })))
  const instructions = `Character mode: only the captured story context and the scoped read/search tools are available. Do not invent another participant. Prefix each speaker turn with @<token>: using the exact token below; the app renders its chosen display label. A character may not have witnessed every prior event. Facts the user supplies are user instructions, not automatically verified story knowledge.\nSelected participants: ${JSON.stringify(speakers)}\nAvailable opaque source IDs: ${JSON.stringify([current, ...selected.map(item => item.source)].map(({ id, kind }) => ({ id, kind })))}; search finds other allowed sources.\nWorkspace mutations require approval in author chat. Still images require an explicit request in the current user turn.`
  return { boundary: { cutoff: { ...config.cutoff }, fingerprint, sessionId: config.sessionId }, sources, context, instructions }
}
export async function captureCharacterFrame(chat: ChatEntity, history: Array<Pick<ChatMessageEntity, 'role' | 'content'> & Partial<Pick<ChatMessageEntity, 'characterBoundary'>>>): Promise<CharacterFrame> {
  if (!chat.character) throw new Error('Character chat has no stored boundary.')
  const current = await getChat(chat.id)
  if (JSON.stringify(current?.character) !== JSON.stringify(chat.character)) throw new Error('The character chat position changed. Reload it before sending.')
  const world = await readTimelineWorld(chat.bookId), entries = await listEntitiesByBook(chat.bookId, 'codexEntry') as CodexEntryEntity[]
  const frames = new Map<string, CharacterFrame>()
  const frame = await frameFor(chat.character, entries, world)
  frames.set(JSON.stringify(chat.character.cutoff), frame)
  for (const message of history.filter(message => message.role === 'assistant' && (message.characterBoundary || message.content.trim()))) {
    const previous = message.characterBoundary
    if (!previous || previous.sessionId !== chat.character.sessionId || compareStoryPositions(previous.cutoff, chat.character.cutoff, world) > 0) throw new Error('This history was informed by another or later story boundary. Start a new character chat at this position.')
    const key = JSON.stringify(previous.cutoff)
    let verified = frames.get(key)
    if (!verified) { verified = await frameFor({ ...chat.character, cutoff: previous.cutoff }, entries, world); frames.set(key, verified) }
    if (verified.boundary.fingerprint !== previous.fingerprint) throw new Error('The story or eligible lore changed since these replies. Restart at this position to use the revised story without old knowledge.')
  }
  return frame
}
export function executeCharacterRead(frame: CharacterFrame, call: ChatToolCall): string {
  try {
    const args = JSON.parse(call.function.arguments || '{}')
    if (call.function.name === 'read_story_context') {
      const source = frame.sources.find(source => source.id === args.source_id)
      if (!source) throw new Error('This source is unavailable within the captured story boundary.')
      return JSON.stringify({ ok: true, source })
    }
    if (call.function.name === 'search_story_context') {
      if (typeof args.query !== 'string' || !args.query.trim() || !Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0) throw new Error('Provide a search query and nonnegative offset.')
      const query = args.query.toLocaleLowerCase(), matches = frame.sources.filter(source => source.content.toLocaleLowerCase().includes(query)), offset = args.offset ?? 0
      return JSON.stringify({ ok: true, results: matches.slice(offset, offset + 12).map(source => { const start = Math.max(0, source.content.toLocaleLowerCase().indexOf(query) - 80); return { id: source.id, kind: source.kind, snippet: source.content.slice(start, start + 320) } }), next_offset: offset + 12 < matches.length ? offset + 12 : null })
    }
    throw new Error('This tool is unavailable in character mode.')
  } catch (error) { return JSON.stringify({ ok: false, error: (error as Error).message }) }
}
