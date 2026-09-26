import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'
import { protectedRanges } from './document-projection'
import { findDialogueRanges } from './dialogue-highlighting'

function dialogueDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString(), excluded = protectedRanges(text)
  syntaxTree(state).iterate({ enter(node) {
    if (/Code|HTML|URL|LinkTitle|Image|Table/.test(node.name)) {
      excluded.push({ from: node.from, to: node.to })
      return false
    }
  } })
  return Decoration.set(findDialogueRanges(text, excluded).map(({ from, to }) => Decoration.mark({ class: 'cm-dialogue' }).range(from, to)))
}

export const dialogueHighlight = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = dialogueDecorations(view.state) }
  update(update: ViewUpdate) {
    if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = dialogueDecorations(update.state)
  }
}, { decorations: plugin => plugin.decorations })
