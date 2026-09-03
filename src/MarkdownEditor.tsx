import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, Transaction } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import './markdown-editor.css'

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

export type GenerationStart = {
  id: number
  document: string
  position: number
}

export type GenerationResult = {
  generatedText: string
  document: string
}

export type MarkdownEditorHandle = {
  beginGeneration: (position?: number) => GenerationStart | null
  appendGeneration: (id: number, text: string) => boolean
  finishGeneration: (id: number) => GenerationResult | null
  restoreDocument: (document: string, position: number) => boolean
  insertSpeech: () => boolean
  undo: () => boolean
  redo: () => boolean
}

type ActiveGeneration = GenerationStart & {
  generatedText: string
  contentTo: number
}

const SPEECH_TEXT = 'speech placeholder'

class ListMarkerWidget extends WidgetType {
  constructor(readonly label: string) { super() }
  eq(other: ListMarkerWidget) { return other.label === this.label }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-list-marker'
    span.textContent = `${this.label} `
    return span
  }
}

class RuleWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-rule'
    return span
  }
}

function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const activeLine = state.doc.lineAt(state.selection.main.head).number
  const ranges: any[] = []
  const hide = (from: number, to: number) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)) }
  const mark = (from: number, to: number, className: string) => { if (to > from) ranges.push(Decoration.mark({ class: className }).range(from, to)) }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    if (lineNumber === activeLine) continue
    const line = state.doc.line(lineNumber)
    const text = line.text
    const heading = text.match(/^(#{1,6})\s+/)
    if (heading) {
      hide(line.from, line.from + heading[0].length)
      mark(line.from + heading[0].length, line.to, `cm-live-heading cm-live-heading-${heading[1].length}`)
    }
    const quote = text.match(/^>\s?/)
    if (quote) {
      hide(line.from, line.from + quote[0].length)
      mark(line.from + quote[0].length, line.to, 'cm-live-quote')
    }
    const unordered = text.match(/^(\s*)[-+*]\s+/)
    if (unordered) {
      const markerStart = line.from + unordered[1].length
      hide(markerStart, line.from + unordered[0].length)
      ranges.push(Decoration.widget({ widget: new ListMarkerWidget('•'), side: 1 }).range(markerStart))
    }
    const ordered = text.match(/^(\s*)(\d+)[.)]\s+/)
    if (ordered) {
      const markerStart = line.from + ordered[1].length
      hide(markerStart, line.from + ordered[0].length)
      ranges.push(Decoration.widget({ widget: new ListMarkerWidget(`${ordered[2]}.`), side: 1 }).range(markerStart))
    }
    if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(text)) {
      hide(line.from, line.to)
      ranges.push(Decoration.widget({ widget: new RuleWidget() }).range(line.from))
      continue
    }
    for (const matchResult of text.matchAll(/~~([^~\n]+)~~/g)) {
      const start = line.from + (matchResult.index ?? 0)
      const end = start + matchResult[0].length
      hide(start, start + 2)
      hide(end - 2, end)
      mark(start + 2, end - 2, 'cm-live-strike')
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      const line = state.doc.lineAt(node.from)
      if (line.number === activeLine || node.to > line.to) return
      if (node.name === 'StrongEmphasis') { mark(node.from, node.to, 'cm-live-bold'); return }
      if (node.name === 'Emphasis') { mark(node.from, node.to, 'cm-live-italic'); return }
      if (node.name === 'Link') {
        const raw = state.doc.sliceString(node.from, node.to)
        const matchResult = raw.match(/^\[([^\]\n]+)\]\(([^)\n]+)\)$/)
        if (matchResult) {
          const labelFrom = node.from + 1
          const labelTo = labelFrom + matchResult[1].length
          hide(node.from, labelFrom)
          hide(labelTo, node.to)
          mark(labelFrom, labelTo, 'cm-live-link')
          return false
        }
      }
      if (node.name === 'EmphasisMark') hide(node.from, node.to)
    },
  })
  return Decoration.set(ranges, true)
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = buildLivePreviewDecorations(view.state) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildLivePreviewDecorations(update.state)
  }
}, { decorations: plugin => plugin.decorations })

function formattingKeymap() {
  const wrapSelection = (marker: string) => (view: EditorView) => {
    const selection = view.state.selection.main
    if (selection.empty) return false
    const selected = view.state.sliceDoc(selection.from, selection.to)
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${marker}${selected}${marker}` },
      selection: { anchor: selection.from + marker.length, head: selection.to + marker.length },
    })
    return true
  }
  return [{ key: 'Mod-b', run: wrapSelection('**') }, { key: 'Mod-i', run: wrapSelection('_') }]
}

function insertAtSelection(view: EditorView, text: string) {
  const selection = view.state.selection.main
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

function paragraphBoundary(left: string, right: string) {
  const before = !left ? '' : left.endsWith('\n\n') ? '' : left.endsWith('\n') ? '\n' : '\n\n'
  const after = !right ? '' : right.startsWith('\n\n') ? '' : right.startsWith('\n') ? '\n' : '\n\n'
  return { before, after }
}

function runHistoryCommand(view: EditorView | null, command: (target: EditorView) => boolean) {
  if (!view) return false
  view.focus()
  return command(view)
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, ariaLabel = 'Markdown editor', className = '' },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const activeGenerationRef = useRef<ActiveGeneration | null>(null)
  const generationIdRef = useRef(0)
  const suppressChangeRef = useRef(false)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useImperativeHandle(ref, () => ({
    beginGeneration: (positionOverride) => {
      const view = viewRef.current
      if (!view || activeGenerationRef.current) return null
      const document = view.state.doc.toString()
      const selection = view.state.selection.main
      const position = Math.max(0, Math.min(positionOverride ?? selection.head, document.length))
      const { before, after } = paragraphBoundary(document.slice(0, position), document.slice(position))
      const contentFrom = position + before.length
      const id = ++generationIdRef.current
      view.dispatch({
        changes: { from: position, insert: `${before}${after}` },
        selection: { anchor: contentFrom },
        annotations: Transaction.addToHistory.of(false),
      })
      activeGenerationRef.current = { id, document, position, generatedText: '', contentTo: contentFrom }
      return { id, document, position }
    },
    appendGeneration: (id, text) => {
      const view = viewRef.current
      const active = activeGenerationRef.current
      if (!view || !active || active.id !== id || !text) return false
      view.dispatch({
        changes: { from: active.contentTo, insert: text },
        selection: { anchor: active.contentTo + text.length },
        annotations: Transaction.addToHistory.of(false),
      })
      active.contentTo += text.length
      active.generatedText += text
      return true
    },
    finishGeneration: (id) => {
      const view = viewRef.current
      const active = activeGenerationRef.current
      if (!view || !active || active.id !== id) return null
      const generatedText = active.generatedText
      if (!generatedText) {
        suppressChangeRef.current = true
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: active.document },
          selection: { anchor: active.position },
          annotations: Transaction.addToHistory.of(false),
        })
        suppressChangeRef.current = false
        onChangeRef.current(active.document)
        activeGenerationRef.current = null
        return { generatedText: '', document: active.document }
      }

      const finalDocument = view.state.doc.toString()
      const finalSelection = active.contentTo
      suppressChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: active.document },
        annotations: Transaction.addToHistory.of(false),
      })
      suppressChangeRef.current = false
      view.dispatch({
        changes: { from: 0, to: active.document.length, insert: finalDocument },
        selection: { anchor: finalSelection },
        scrollIntoView: true,
      })
      activeGenerationRef.current = null
      view.focus()
      return { generatedText, document: finalDocument }
    },
    restoreDocument: (document, position) => {
      const view = viewRef.current
      if (!view || activeGenerationRef.current) return false
      const anchor = Math.max(0, Math.min(position, document.length))
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: document },
        selection: { anchor },
        annotations: Transaction.addToHistory.of(false),
      })
      view.focus()
      return true
    },
    insertSpeech: () => viewRef.current ? insertAtSelection(viewRef.current, SPEECH_TEXT) : false,
    undo: () => runHistoryCommand(viewRef.current, undo),
    redo: () => runHistoryCommand(viewRef.current, redo),
  }), [])

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        markdown(),
        history(),
        keymap.of([...formattingKeymap(), ...defaultKeymap, ...historyKeymap]),
        livePreview,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'true' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !suppressChangeRef.current) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', width: '100%', maxWidth: '100%' },
          '.cm-scroller': { fontFamily: 'inherit', maxWidth: '100%' },
          '.cm-content': { caretColor: 'var(--accent-bright)', minWidth: '0' },
          '.cm-cursor': { borderLeftColor: 'var(--accent-bright)' },
          '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(198,168,107,.18)' },
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
    if (!view || activeGenerationRef.current) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [value])

  return <div ref={hostRef} className={`markdown-editor ${className}`.trim()} />
})

export default MarkdownEditor
