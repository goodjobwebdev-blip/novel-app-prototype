import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { parsePromptTemplate, type PromptTemplateDiagnostic } from './prompt-composition'
import './prompt-template-editor.css'

export type PromptTemplateEditorHandle = {
  insert: (text: string, selectionOffset?: number) => void
  focus: () => void
}

type PromptTemplateEditorProps = {
  value: string
  diagnostics: PromptTemplateDiagnostic[]
  onChange: (value: string) => void
  ariaLabel: string
}

const setDiagnostics = StateEffect.define<PromptTemplateDiagnostic[]>()
const diagnosticsField = StateField.define<PromptTemplateDiagnostic[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setDiagnostics)) return effect.value
    return value
  },
})

function templateDecorations(state: EditorState) {
  const ranges = [] as Array<ReturnType<Decoration['range']>>
  const parsed = parsePromptTemplate(state.doc.toString())
  for (const token of parsed.tokens) {
    if (token.type === 'variable') ranges.push(Decoration.mark({ class: 'cm-prompt-variable' }).range(token.from, token.to))
    if (token.type === 'if' || token.type === 'endif') ranges.push(Decoration.mark({ class: 'cm-prompt-control' }).range(token.from, token.to))
  }
  for (const diagnostic of state.field(diagnosticsField)) {
    const from = Math.max(0, Math.min(diagnostic.from, state.doc.length))
    const to = Math.max(from, Math.min(diagnostic.to, state.doc.length))
    if (to > from) {
      ranges.push(Decoration.mark({
        class: diagnostic.severity === 'error' ? 'cm-prompt-error' : 'cm-prompt-warning',
        attributes: { title: diagnostic.message, 'data-diagnostic': diagnostic.message },
      }).range(from, to))
    }
  }
  return Decoration.set(ranges, true)
}

const templateHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = templateDecorations(view.state)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.startState.field(diagnosticsField) !== update.state.field(diagnosticsField)) {
      this.decorations = templateDecorations(update.state)
    }
  }
}, { decorations: (plugin) => plugin.decorations })

const PromptTemplateEditor = forwardRef<PromptTemplateEditorHandle, PromptTemplateEditorProps>(function PromptTemplateEditor(
  { value, diagnostics, onChange, ariaLabel },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useImperativeHandle(ref, () => ({
    insert(text, selectionOffset = text.length) {
      const view = viewRef.current
      if (!view) return
      const selection = view.state.selection.main
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + selectionOffset },
      })
      view.focus()
    },
    focus() {
      viewRef.current?.focus()
    },
  }), [])

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        diagnosticsField,
        templateHighlighter,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', width: '100%' },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-content': { caretColor: 'var(--accent-bright)', minWidth: '0' },
          '.cm-cursor': { borderLeftColor: 'var(--accent-bright)' },
          '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(198,168,107,.2)' },
          '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.018)' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [ariaLabel])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setDiagnostics.of(diagnostics) })
    view.contentDOM.setAttribute('aria-invalid', diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'true' : 'false')
  }, [diagnostics])

  return <div ref={hostRef} className="prompt-template-editor" />
})

export default PromptTemplateEditor
