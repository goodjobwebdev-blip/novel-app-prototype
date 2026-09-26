import { useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { syntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import MarkdownTable from './MarkdownTable'
import { markdownTableRanges, selectionTouchesTable, type MarkdownTableRange } from './markdown-tables'

const tableFocus = StateEffect.define<boolean>()
const roots = new WeakMap<HTMLElement, Root>()

function TableContent({ markdown, onRendered }: { markdown: string; onRendered: () => void }) {
  useLayoutEffect(onRendered, [onRendered])
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable }}>{markdown}</ReactMarkdown>
}

class TableWidget extends WidgetType {
  constructor(readonly table: MarkdownTableRange, readonly editable: boolean) { super() }
  eq(other: TableWidget) { return this.table.from === other.table.from && this.table.markdown === other.table.markdown && this.editable === other.editable }
  toDOM(view: EditorView) {
    const dom = document.createElement('div')
    dom.className = 'cm-table-preview'
    dom.contentEditable = 'false'
    if (this.editable) {
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'cm-table-edit'
      edit.textContent = 'Edit table'
      edit.addEventListener('mousedown', (event) => event.preventDefault())
      edit.addEventListener('click', () => {
        view.dispatch({ selection: { anchor: this.table.from }, effects: tableFocus.of(true), scrollIntoView: true })
        view.focus()
      })
      dom.append(edit)
    }
    const content = document.createElement('div')
    dom.append(content)
    const root = createRoot(content)
    roots.set(dom, root)
    const measure = () => { if (dom.isConnected) view.requestMeasure() }
    root.render(<TableContent markdown={this.table.markdown} onRendered={measure} />)
    dom.addEventListener('load', measure, true)
    return dom
  }
  destroy(dom: HTMLElement) {
    const root = roots.get(dom)
    roots.delete(dom)
    // The containing React editor may itself be unmounting.
    if (root) queueMicrotask(() => root.unmount())
  }
  ignoreEvent() { return true }
}

type TablePreviewState = { focused: boolean; decorations: DecorationSet }
function tableDecorations(state: EditorState, focused: boolean) {
  const editable = !state.readOnly && state.facet(EditorView.editable)
  return Decoration.set(markdownTableRanges(state)
    .filter((table) => !(editable && focused && selectionTouchesTable(state, table)))
    .map((table) => Decoration.replace({ widget: new TableWidget(table, editable), block: true }).range(table.from, table.to)), true)
}

// Multiline replacements must come from a StateField, rather than a ViewPlugin.
export const tablePreviewField = StateField.define<TablePreviewState>({
  create: (state) => ({ focused: false, decorations: tableDecorations(state, false) }),
  update(value, transaction) {
    let focused = value.focused
    for (const effect of transaction.effects) if (effect.is(tableFocus)) focused = effect.value
    if (transaction.docChanged || transaction.selection || focused !== value.focused
      || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      || transaction.startState.facet(EditorView.editable) !== transaction.state.facet(EditorView.editable)
      || transaction.startState.readOnly !== transaction.state.readOnly) {
      return { focused, decorations: tableDecorations(transaction.state, focused) }
    }
    return value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})

export const markdownTablePreview = [
  tablePreviewField,
  EditorView.focusChangeEffect.of((_state, focused) => tableFocus.of(focused)),
]
