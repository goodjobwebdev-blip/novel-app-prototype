import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export type MarkdownTableRange = { from: number; to: number; markdown: string }

export function markdownTableRanges(state: EditorState): MarkdownTableRange[] {
  const tables: MarkdownTableRange[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'Table') return
    // Include quote/list prefixes so nested tables retain their Markdown context.
    const from = state.doc.lineAt(node.from).from
    tables.push({ from, to: node.to, markdown: state.doc.sliceString(from, node.to) })
    return false
  } })
  return tables
}

export function selectionTouchesTable(state: EditorState, table: MarkdownTableRange) {
  return state.selection.ranges.some((range) => range.from <= table.to && range.to >= table.from)
}
