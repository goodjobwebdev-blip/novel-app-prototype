import type { ChatCodexCreationProposal, ChatDocumentEditProposal, ChatEntityActionProposal, ChatOutlineActionProposal } from './chat-service'

export type ProposalDraft = { originalDraft?: Record<string, string>; editedValues?: Record<string, string>; draftRevision?: number }
export type EditableProposal = ChatDocumentEditProposal | ChatCodexCreationProposal | ChatOutlineActionProposal | ChatEntityActionProposal
export type EditableProposalField = 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'
export type DraftField = { key: string; label: string; value: string; multiline?: boolean; required?: boolean; options?: string[] }
const categories = ['Character', 'Place', 'Object', 'Event', 'Group', 'Other']

export function proposalDraftFields(field: EditableProposalField, proposal: EditableProposal): DraftField[] {
  const result: DraftField[] = []
  const add = (key: string, label: string, value: unknown, multiline = false, required = false, options?: string[]) => result.push({ key, label, value: String(value ?? ''), multiline, required, options })
  if (field === 'documentEdits') {
    const p = proposal as ChatDocumentEditProposal
    if (p.mode === 'replace_document') add('newContent', 'Replacement document', p.newContent, true)
    else p.edits?.forEach((edit, index) => add(`edit:${index}`, `Replacement ${index + 1}`, edit.newText, true))
  } else if (field === 'codexCreations') {
    const p = proposal as ChatCodexCreationProposal
    add('title', 'Title', p.title, false, true)
    add('category', 'Type', p.category, false, true, categories)
    add('content', 'Body', p.content, true)
  } else if (field === 'outlineActions') {
    const p = proposal as ChatOutlineActionProposal
    if (p.action === 'create' || p.action === 'rename') add('newTitle', 'Title', p.newTitle || p.entityTitle, false, true)
    if (p.action === 'create' && p.entityType === 'scene') add('initialContent', 'Initial scene', p.initialContent, true)
  } else {
    const p = proposal as ChatEntityActionProposal
    if (p.action === 'rename' || p.action === 'create_note') add('newTitle', 'Title', p.newTitle || p.entityTitle, false, true)
    if (p.action === 'create_note') add('content', 'Note body', p.content, true)
    if (p.action === 'set_codex_category') add('category', 'Type', p.category, false, true, categories)
    const op = p.operation
    if (op?.kind === 'metadata' || op?.kind === 'scene_metadata') {
      for (const [key, value] of Object.entries(op.patch)) {
        // A different series is a different target, requiring a new validated proposal.
        if (key !== 'seriesId') add(`patch:${key}`, key, value, ['overview', 'writingStyle'].includes(key), key === 'title')
      }
    }
    if (op?.kind === 'beat') add('beatText', 'Scene beat', op.text, true, true)
    if (op?.kind === 'triggers') add('triggers', 'Triggers (one per line)', op.triggers.join('\n'), true)
    if (op?.kind === 'dependency' && op.action !== 'remove') {
      add('relationLabel', 'Relationship', op.relationLabel)
      add('includeWithSource', 'Include with source', String(op.includeWithSource), false, true, ['true', 'false'])
    }
  }
  return result
}

export function proposalDraftValues(field: EditableProposalField, proposal: EditableProposal) {
  return Object.fromEntries(proposalDraftFields(field, proposal).map(item => [item.key, item.value]))
}

/** Accept only editable values; targets, before-text, operation and revisions remain immutable. */
export function editProposalDraft(field: EditableProposalField, current: EditableProposal, values: Record<string, string>, expectedRevision: number): EditableProposal {
  if (current.status !== 'proposed') throw new Error('Only pending proposals can be edited.')
  if ((current.draftRevision ?? 0) !== expectedRevision) throw new Error('This draft changed elsewhere. Reopen it before editing.')
  const fields = proposalDraftFields(field, current)
  if (!fields.length || Object.keys(values).length !== fields.length || fields.some(item => typeof values[item.key] !== 'string') || Object.keys(values).some(key => !fields.some(item => item.key === key))) throw new Error('The draft contains unsupported changes.')
  for (const item of fields) {
    if (item.required && !values[item.key].trim()) throw new Error(`${item.label} cannot be empty.`)
    if (item.options && !item.options.includes(values[item.key])) throw new Error(`Choose a valid ${item.label.toLowerCase()}.`)
  }
  const next = structuredClone(current)
  next.originalDraft ??= proposalDraftValues(field, current)
  next.draftRevision = expectedRevision + 1
  next.editedValues = structuredClone(values)
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('edit:')) (next as ChatDocumentEditProposal).edits![Number(key.slice(5))].newText = value
    else if (key.startsWith('patch:')) {
      const op = (next as ChatEntityActionProposal).operation
      if (op?.kind === 'metadata' || op?.kind === 'scene_metadata') Object.assign(op.patch, { [key.slice(6)]: value })
    } else if (key === 'beatText') {
      const op = (next as ChatEntityActionProposal).operation
      if (op?.kind === 'beat') op.text = value
    } else if (key === 'triggers') {
      const op = (next as ChatEntityActionProposal).operation
      if (op?.kind === 'triggers') op.triggers = [...new Set(value.split('\n').map(text => text.trim()).filter(Boolean))]
    } else if (key === 'relationLabel' || key === 'includeWithSource') {
      const op = (next as ChatEntityActionProposal).operation
      if (op?.kind === 'dependency') {
        if (key === 'relationLabel') op.relationLabel = value
        else op.includeWithSource = value === 'true'
      }
    } else Object.assign(next, { [key]: value })
  }
  if (field === 'outlineActions' && (next as ChatOutlineActionProposal).action === 'create') (next as ChatOutlineActionProposal).entityTitle = (next as ChatOutlineActionProposal).newTitle!
  if (field === 'entityActions') {
    const p = next as ChatEntityActionProposal
    if (p.action === 'create_note') { p.entityTitle = p.newTitle!; p.contentLength = p.content?.length ?? 0 }
    const op = p.operation
    if (op?.kind === 'metadata' || op?.kind === 'scene_metadata') p.changes = Object.entries(op.patch).map(([key, value]) => ({ field: key, before: String(op.before[key as keyof typeof op.before] ?? ''), after: String(value) }))
    if (op?.kind === 'beat') p.changes = [{ field: 'Scene beat (planning)', before: op.before ?? 'No beat', after: op.text }]
    if (op?.kind === 'triggers') p.changes = [{ field: 'Triggers', before: op.before.join('\n'), after: op.triggers.join('\n') }]
    if (op?.kind === 'dependency') p.changes = [{ field: 'Relationship', before: op.before?.relationLabel ?? '', after: `${op.relationLabel} · Include with source: ${op.includeWithSource}` }]
  }
  return next
}
