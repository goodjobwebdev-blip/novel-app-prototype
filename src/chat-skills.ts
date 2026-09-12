import { getEffectiveLoreTypes } from './lore-types-service'
import { database, listEntitiesByBook, updateEntityAtomically, type GenerationContextProfile, type NoteEntity } from './persistence'
import { projectProse } from './document-projection'
import { buildContextValues } from './context-service'
import type { NormalizedRequestPart } from './prompt-composition'

export const starterChatSkills = [
  { id: 'brainstorm', title: 'Brainstorm', description: 'Explore distinct story directions and let you choose.', content: 'Help me explore distinct story directions. Ask a focused question when essential context is missing. Use present_brainstorm to offer 2–8 concrete options with meaningful trade-offs when I ask for ideas. Do not select an option for me or change my manuscript without an accepted proposal.' },
  { id: 'developmental', title: 'Developmental editor', description: 'Review structure, character motivation, pacing, and stakes.', content: 'Act as a developmental editor. Focus on structure, character motivation, pacing, stakes, and reader expectations. Ground observations in the supplied manuscript, distinguish evidence from suggestions, and prioritize a few actionable improvements. Preserve the author’s intended voice. Use approval proposals for requested edits.' },
  { id: 'copy', title: 'Copy editor', description: 'Improve clarity, grammar, and consistency while preserving voice.', content: 'Act as a careful copy editor. Improve grammar, clarity, and consistency while preserving voice, meaning, and intentional stylistic choices. Explain ambiguous changes briefly. Prefer localized edit proposals over whole-document rewrites; never claim a proposal has already been applied.' },
  { id: 'continuity', title: 'Continuity check', description: 'Check facts, chronology, and character knowledge against available context.', content: 'Check continuity against the supplied material: facts, chronology, character knowledge, names, places, and established rules. Cite specific inconsistencies and distinguish missing evidence from contradictions. Respect the available timeline and context; do not infer inaccessible facts. Suggest possible resolutions for the author to approve.' },
] as const
export type CapturedChatSkill = { id: string; title: string; content: string }
export function skillFromNote(note: NoteEntity): CapturedChatSkill | null {
  const content = projectProse(note.content).text
  return note.useAsChatSkill && content.trim() ? { id: note.id, title: note.title, content } : null
}
export async function listSkillNotes(bookId: string) {
  return (await listEntitiesByBook(bookId, 'note')).filter((note): note is NoteEntity => note.type === 'note')
}
export async function captureChatSkills(bookId: string, noteIds: string[] = []) {
  const notes = await listSkillNotes(bookId)
  const byId = new Map(notes.map(note => [note.id, note]))
  return [...new Set(noteIds)].flatMap(id => { const note = byId.get(id); const skill = note && skillFromNote(note); return skill ? [skill] : [] })
}
export async function prepareChatSkillContext(chat: { bookId: string; skillNoteIds?: string[]; contextProfile: GenerationContextProfile }, currentSceneId?: string) {
  const skills = await captureChatSkills(chat.bookId, chat.skillNoteIds)
  const ids = new Set(skills.map(skill => skill.id))
  const context = await buildContextValues({ bookId: chat.bookId, type: 'chat', currentSceneId, profile: { ...chat.contextProfile, noteIds: chat.contextProfile.noteIds.filter(id => !ids.has(id)) } })
  return { context, skills, loreTypes: await getEffectiveLoreTypes(chat.bookId) }
}
export function chatSkillParts(skills: CapturedChatSkill[] = []): NormalizedRequestPart[] {
  const seen = new Set<string>()
  return skills.filter(skill => skill.content.trim() && !seen.has(skill.id) && Boolean(seen.add(skill.id))).map(skill => ({ id: `chat-skill-${skill.id}`, sourceId: skill.id, sourceKind: 'app-managed', role: 'system', name: `Chat skill: ${skill.title}`, ownership: 'user-configuration', content: skill.content, referencedVariables: [], enabled: true, omitted: false }))
}
export async function setNoteChatSkill(bookId: string, noteId: string, enabled: boolean) {
  return updateEntityAtomically<NoteEntity>(noteId, current => {
    if (current.type !== 'note' || current.bookId !== bookId) throw new Error('This Note is no longer available in this book.')
    return { ...current, useAsChatSkill: enabled, updatedAt: Date.now() }
  })
}
export async function copyStarterChatSkill(bookId: string, starterId: string) {
  const starter = starterChatSkills.find(skill => skill.id === starterId)
  if (!starter) throw new Error('This starter skill is unavailable.')
  const db = await database()
  const now = Date.now()
  const note: NoteEntity = { id: `note-${crypto.randomUUID()}`, bookId, parentId: bookId, type: 'note', title: starter.title, content: starter.content, useAsChatSkill: true, createdAt: now, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    if ((await db.table('entities').get(bookId))?.type !== 'book') throw new Error('This book is no longer available.')
    await db.table('entities').put(note)
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('arc-entity-changed', { detail: { bookId, entityId: note.id } }))
  return note
}
