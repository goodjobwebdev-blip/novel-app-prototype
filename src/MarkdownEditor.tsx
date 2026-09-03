import { useEffect, useRef } from 'react'
import './markdown-editor.css'

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

type CodeMirrorModules = {
  EditorState: any
  EditorView: any
  Decoration: any
  keymap: any
  history: any
  historyKeymap: any
  defaultKeymap: any
  markdown: any
}

const codeMirrorUrls = {
  state: 'https://esm.sh/@codemirror/state@6.5.2',
  view: 'https://esm.sh/@codemirror/view@6.38.1',
  commands: 'https://esm.sh/@codemirror/commands@6.8.1',
  markdown: 'https://esm.sh/@codemirror/lang-markdown@6.3.3',
}

let modulePromise: Promise<CodeMirrorModules> | null = null

function loadCodeMirror() {
  if (!modulePromise) {
    modulePromise = Promise.all([
      import(/* @vite-ignore */ codeMirrorUrls.state),
      import(/* @vite-ignore */ codeMirrorUrls.view),
      import(/* @vite-ignore */ codeMirrorUrls.commands),
      import(/* @vite-ignore */ codeMirrorUrls.markdown),
    ]).then(([state, view, commands, markdownLanguage]) => ({
      EditorState: state.EditorState,
      EditorView: view.EditorView,
      Decoration: view.Decoration,
      keymap: view.keymap,
      history: commands.history,
      historyKeymap: commands.historyKeymap,
      defaultKeymap: commands.defaultKeymap,
      markdown: markdownLanguage.markdown,
    }))
  }
  return modulePromise
}

function rangesForInactiveLine(lineText: string, lineFrom: number, Decoration: any) {
  const ranges: any[] = []
  const hidden = (from: number, to: number) => ranges.push(Decoration.replace({}).range(lineFrom + from, lineFrom + to))
  const mark = (from: number, to: number, className: string) => ranges.push(Decoration.mark({ class: className }).range(lineFrom + from, lineFrom + to))

  const heading = lineText.match(/^(#{1,6})\s+/)
  if (heading) {
    hidden(0, heading[0].length)
    mark(heading[0].length, lineText.length, `cm-live-heading cm-live-heading-${heading[1].length}`)
  }

  const quote = lineText.match(/^>\s?/)
  if (quote) {
    hidden(0, quote[0].length)
    mark(quote[0].length, lineText.length, 'cm-live-quote')
  }

  const unordered = lineText.match(/^(\s*)[-+*]\s+/)
  if (unordered) {
    const markerStart = unordered[1].length
    hidden(markerStart, unordered[0].length)
    mark(unordered[0].length, lineText.length, 'cm-live-list-item')
    ranges.push(Decoration.widget({ widget: new BulletWidget('•') }).range(lineFrom + markerStart))
  }

  const ordered = lineText.match(/^(\s*)\d+[.)]\s+/)
  if (ordered) {
    const markerStart = ordered[1].length
    const label = ordered[0].slice(markerStart).trim()
    hidden(markerStart, ordered[0].length)
    mark(ordered[0].length, lineText.length, 'cm-live-list-item')
    ranges.push(Decoration.widget({ widget: new BulletWidget(label) }).range(lineFrom + markerStart))
  }

  if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(lineText)) {
    hidden(0, lineText.length)
    ranges.push(Decoration.widget({ widget: new RuleWidget() }).range(lineFrom))
    return ranges
  }

  const patterns = [
    { regex: /\*\*([^*\n]+)\*\*/g, className: 'cm-live-bold', edge: 2 },
    { regex: /__([^_\n]+)__/g, className: 'cm-live-bold', edge: 2 },
    { regex: /~~([^~\n]+)~~/g, className: 'cm-live-strike', edge: 2 },
    { regex: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, className: 'cm-live-italic', edge: 1 },
    { regex: /(?<!_)_([^_\n]+)_(?!_)/g, className: 'cm-live-italic', edge: 1 },
  ]

  for (const { regex, className, edge } of patterns) {
    for (const match of lineText.matchAll(regex)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      hidden(start, start + edge)
      hidden(end - edge, end)
      mark(start + edge, end - edge, className)
    }
  }

  const linkRegex = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
  for (const match of lineText.matchAll(linkRegex)) {
    const start = match.index ?? 0
    const labelStart = start + 1
    const labelEnd = labelStart + match[1].length
    const end = start + match[0].length
    hidden(start, labelStart)
    hidden(labelEnd, end)
    mark(labelStart, labelEnd, 'cm-live-link')
  }

  return ranges
}

class BulletWidget {
  label: string
  constructor(label: string) { this.label = label }
  eq(other: BulletWidget) { return other.label === this.label }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-list-marker'
    span.textContent = `${this.label} `
    return span
  }
  ignoreEvent() { return true }
}

class RuleWidget {
  eq() { return true }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-rule'
    return span
  }
  ignoreEvent() { return true }
}

function formattingKeymap() {
  const wrapSelection = (marker: string) => (view: any) => {
    const selection = view.state.selection.main
    if (selection.empty) return false
    const selected = view.state.sliceDoc(selection.from, selection.to)
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${marker}${selected}${marker}` },
      selection: { anchor: selection.from + marker.length, head: selection.to + marker.length },
    })
    return true
  }

  return [
    { key: 'Mod-b', run: wrapSelection('**') },
    { key: 'Mod-i', run: wrapSelection('_') },
  ]
}

export default function MarkdownEditor({ value, onChange, ariaLabel = 'Markdown editor', className = '' }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    let cancelled = false

    loadCodeMirror().then(({ EditorState, EditorView, Decoration, keymap, history, historyKeymap, defaultKeymap, markdown }) => {
      if (cancelled || !hostRef.current) return

      const livePreview = EditorView.decorations.compute(['doc', 'selection'], (state: any) => {
        const activeLine = state.doc.lineAt(state.selection.main.head).number
        const ranges: any[] = []
        for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
          if (lineNumber === activeLine) continue
          const line = state.doc.line(lineNumber)
          ranges.push(...rangesForInactiveLine(line.text, line.from, Decoration))
        }
        return Decoration.set(ranges, true)
      })

      const state = EditorState.create({
        doc: value,
        extensions: [
          markdown(),
          history(),
          keymap.of([...formattingKeymap(), ...defaultKeymap, ...historyKeymap]),
          livePreview,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'true' }),
          EditorView.updateListener.of((update: any) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { backgroundColor: 'transparent' },
            '.cm-scroller': { fontFamily: 'inherit' },
            '.cm-content': { caretColor: 'var(--accent-bright)' },
            '.cm-cursor': { borderLeftColor: 'var(--accent-bright)' },
            '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(198,168,107,.18)' },
            '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.018)' },
          }),
        ],
      })

      viewRef.current = new EditorView({ state, parent: hostRef.current })
    })

    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [ariaLabel])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div ref={hostRef} className={`markdown-editor ${className}`.trim()} />
}
