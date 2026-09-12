import type { BookEntity, EditableEntity } from './persistence'
import type { BookPromptValues } from './prompt-template'
import type { EditorSelectionSnapshot } from './MarkdownEditor'
import { projectProse, rangeTouchesProtected } from './document-projection.ts'

export type QuickTool = { id: string; label: string; kind: 'rewrite' | 'synonyms'; examples: string[]; maxWords?: number }
export const quickTools: QuickTool[] = [
  { id: 'make-more', label: 'Make it more…', kind: 'rewrite', examples: ['Make it darker', 'Fix grammar', 'Make the dialogue more natural', 'Make it more concise'] },
  { id: 'synonyms', label: 'Synonyms', kind: 'synonyms', maxWords: 6, examples: [] },
  { id: 'show-dont-tell', label: 'Show, don’t tell', kind: 'rewrite', examples: ['Keep it subtle', 'Keep the dialogue unchanged'] },
  { id: 'sensory-detail', label: 'Sensory detail', kind: 'rewrite', examples: ['Keep the pacing brisk', 'Use restrained detail'] },
]
export type QuickToolCapture = { bookId: string; book: BookPromptValues; document: EditableEntity; snapshot: EditorSelectionSnapshot }
export function selectionWordCount(text: string) { return text.trim().match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0 }
export function selectionProse(capture: Pick<QuickToolCapture, 'snapshot'>) {
  const { snapshot } = capture
  if (snapshot.from < 0 || snapshot.to <= snapshot.from || snapshot.to > snapshot.document.length || snapshot.document.slice(snapshot.from, snapshot.to) !== snapshot.text || !snapshot.text.trim()) throw new Error('Select the prose you want to change.')
  if (rangeTouchesProtected(snapshot.document, snapshot.from, snapshot.to)) throw new Error('Select prose outside image, comment and beat blocks.')
  const projection = projectProse(snapshot.document)
  const from = projection.sourceToProse(snapshot.from), to = projection.sourceToProse(snapshot.to)
  return { source: projection.text, from, to, selected: projection.text.slice(from, to), before: projection.text.slice(Math.max(0, from - 2000), from), after: projection.text.slice(to, to + 2000) }
}
