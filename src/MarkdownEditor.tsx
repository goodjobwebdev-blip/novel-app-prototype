import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { findTriggerRanges, type CodexMentionTerm } from './codex-trigger-service'
import { normalizeTranscriptForInsertion } from './stt-service'
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
import './codex-mentions.css'

export type CodexMentionClick = {
  term: CodexMentionTerm
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
}

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
  readOnly?: boolean
  mentionTerms?: CodexMentionTerm[]
  onMentionClick?: (mention: CodexMentionClick) => void
}

export type MarkdownEditorHandle = {
  beginGeneration: (mode?: 'generate' | 'regenerate', placement?: 'append' | 'replace') => GenerationContext | null
  appendGenerationChunk: (text: string) => boolean
  finishGeneration: (status: GenerationStatus) => GenerationResult | null
  beginDictation: () => string | null
  updateDictation: (sessionId: string, transcript: string) => boolean
  finishDictation: (sessionId: string, transcript: string) => boolean
  cancelDictation: (sessionId: string) => boolean
  undo: () => boolean
  redo: () => boolean
}

export type GenerationStatus = 'complete' | 'cancelled' | 'error'

export type GenerationContext = {
  sceneText: string
  insertionPosition: number
}

export type GenerationResult = GenerationContext & {
  resultDocument: string
  generatedText: string
  status: GenerationStatus
}

type GenerationRecord = GenerationResult & {
  preDocument: string
}

type ActiveGeneration = {
  mode: 'generate' | 'regenerate'
  preDocument: string
  insertionPosition: number
  historyTime: number
  generatedText: string
  generatedFrom: number
  generatedTo: number
  resultDocument: string
  placement: 'append' | 'replace'
}

type ActiveDictation = { id: string; preDocument: string; from: number; to: number; provisional: string }
const dictationProvisional = Annotation.define<boolean>()

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

class GenerationCaretWidget extends WidgetType {
  eq() { return true }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-generation-caret'
    span.setAttribute('aria-hidden', 'true')
    return span
  }
}

type MentionFieldValue = { terms: CodexMentionTerm[]; decorations: DecorationSet }
const setMentionTerms = StateEffect.define<CodexMentionTerm[]>()

function intersects(from: number, to: number, blocked: Array<{ from: number; to: number }>) {
  return blocked.some((range) => range.from < to && range.to > from)
}

function mentionBlockedRanges(state: EditorState) {
  const blocked: Array<{ from: number; to: number }> = []
  syntaxTree(state).iterate({
    enter(node) {
      if (/Code|URL|LinkMark/i.test(node.name)) blocked.push({ from: node.from, to: node.to })
    },
  })
  const text = state.doc.toString()
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/giu)) {
    const from = match.index ?? -1
    if (from >= 0) blocked.push({ from, to: from + match[0].length })
  }
  return blocked
}

function buildMentionDecorations(state: EditorState, terms: CodexMentionTerm[]) {
  if (!terms.length || !state.doc.length) return Decoration.none
  const text = state.doc.toString()
  const blocked = mentionBlockedRanges(state)
  const candidates = terms.flatMap((term) => findTriggerRanges(text, term.text).map((range) => ({ ...range, term })))
    .filter((candidate) => !intersects(candidate.from, candidate.to, blocked))
    .sort((left, right) => left.from - right.from || (right.to - right.from) - (left.to - left.from) || left.term.key.localeCompare(right.term.key))
  const accepted: typeof candidates = []
  let occupiedTo = -1
  candidates.forEach((candidate) => {
    if (candidate.from < occupiedTo) return
    accepted.push(candidate)
    occupiedTo = candidate.to
  })
  return Decoration.set(accepted.map((candidate) => Decoration.mark({
    class: 'cm-codex-mention',
    attributes: { 'data-codex-term': candidate.term.key, 'aria-label': `Codex mention: ${candidate.term.text}` },
  }).range(candidate.from, candidate.to)), true)
}

const mentionField = StateField.define<MentionFieldValue>({
  create: () => ({ terms: [], decorations: Decoration.none }),
  update(value, transaction) {
    let terms = value.terms
    let shouldRebuild = transaction.docChanged
    for (const effect of transaction.effects) {
      if (!effect.is(setMentionTerms)) continue
      terms = effect.value
      shouldRebuild = true
    }
    return shouldRebuild
      ? { terms, decorations: buildMentionDecorations(transaction.state, terms) }
      : { terms, decorations: value.decorations.map(transaction.changes) }
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

type GenerationHighlight = { from: number; to: number; active: boolean } | null
const setGenerationHighlight = StateEffect.define<GenerationHighlight>()

const generationHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setGenerationHighlight)) continue
      if (!effect.value) return Decoration.none
      const { from, to, active } = effect.value
      const ranges: any[] = []
      if (to > from) {
        ranges.push(Decoration.mark({ class: active ? 'cm-generation-active' : 'cm-generation-complete' }).range(from, to))
      }
      if (active) ranges.push(Decoration.widget({ widget: new GenerationCaretWidget(), side: 1 }).range(to))
      next = Decoration.set(ranges, true)
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const activeLine = state.doc.lineAt(state.selection.main.head).number
  const ranges: any[] = []
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to))
  }
  const mark = (from: number, to: number, className: string) => {
    if (to > from) ranges.push(Decoration.mark({ class: className }).range(from, to))
  }

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

      if (node.name === 'StrongEmphasis') {
        mark(node.from, node.to, 'cm-live-bold')
        return
      }

      if (node.name === 'Emphasis') {
        mark(node.from, node.to, 'cm-live-italic')
        return
      }

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

      if (node.name === 'EmphasisMark') {
        hide(node.from, node.to)
      }
    },
  })

  return Decoration.set(ranges, true)
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildLivePreviewDecorations(view.state)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildLivePreviewDecorations(update.state)
    }
  }
}, {
  decorations: plugin => plugin.decorations,
})

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

  return [
    { key: 'Mod-b', run: wrapSelection('**') },
    { key: 'Mod-i', run: wrapSelection('_') },
  ]
}

function dictationInsertion(session: ActiveDictation, transcript: string) {
  const before = session.preDocument.slice(0, session.from)
  const after = session.preDocument.slice(session.to)
  return normalizeTranscriptForInsertion(transcript, before, after)
}

function dictationDocument(session: ActiveDictation, transcript: string) {
  const insertion = dictationInsertion(session, transcript)
  return {
    insertion,
    document: `${session.preDocument.slice(0, session.from)}${insertion}${session.preDocument.slice(session.to)}`,
    cursor: session.from + insertion.length,
  }
}

function generationSeparators(document: string, position: number) {
  const before = document.slice(0, position)
  const after = document.slice(position)
  const beforeSeparator = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const afterSeparator = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  return { beforeSeparator, afterSeparator }
}

function beginGeneration(
  view: EditorView,
  mode: 'generate' | 'regenerate',
  latest: GenerationRecord | null,
  placement: 'append' | 'replace',
): ActiveGeneration | null {
  const current = view.state.doc.toString()
  if (mode === 'regenerate') {
    if (!latest || current !== latest.resultDocument) return null
    return {
      mode,
      preDocument: placement === 'replace' ? current : latest.preDocument,
      insertionPosition: latest.insertionPosition,
      historyTime: Date.now(),
      generatedText: '',
      generatedFrom: latest.insertionPosition,
      generatedTo: latest.insertionPosition,
      resultDocument: current,
      placement,
    }
  }

  const position = view.state.selection.main.head
  return {
    mode,
    preDocument: current,
    insertionPosition: position,
    historyTime: Date.now(),
    generatedText: '',
    generatedFrom: position,
    generatedTo: position,
    resultDocument: current,
    placement,
  }
}

function appendGenerationChunk(view: EditorView, session: ActiveGeneration, text: string) {
  if (!text) return true
  const current = view.state.doc.toString()
  if (current !== session.resultDocument) throw new Error('The scene changed while generation was in progress.')

  const annotations = [
    Transaction.time.of(session.historyTime),
    Transaction.userEvent.of('input.type.generate'),
  ]

  if (!session.generatedText) {
    if (session.placement === 'replace') {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: text },
        effects: setGenerationHighlight.of({ from: 0, to: text.length, active: true }),
        annotations: [Transaction.addToHistory.of(false)],
      })
      session.generatedFrom = 0
      session.generatedTo = text.length
      session.generatedText = text
      session.resultDocument = text
      return true
    }
    const { beforeSeparator, afterSeparator } = generationSeparators(session.preDocument, session.insertionPosition)
    const insertion = `${beforeSeparator}${text}${afterSeparator}`
    const generatedFrom = session.insertionPosition + beforeSeparator.length
    const generatedTo = generatedFrom + text.length
    const nextDocument = `${session.preDocument.slice(0, session.insertionPosition)}${insertion}${session.preDocument.slice(session.insertionPosition)}`

    view.dispatch({
      changes: session.mode === 'regenerate'
        ? { from: 0, to: current.length, insert: nextDocument }
        : { from: session.insertionPosition, insert: insertion },
      effects: setGenerationHighlight.of({ from: generatedFrom, to: generatedTo, active: true }),
      annotations: [...annotations, isolateHistory.of('before')],
    })
    session.generatedFrom = generatedFrom
    session.generatedTo = generatedTo
    session.generatedText = text
    session.resultDocument = nextDocument
    return true
  }

  const generatedTo = session.generatedTo + text.length
  view.dispatch({
    changes: { from: session.generatedTo, insert: text },
    effects: setGenerationHighlight.of({ from: session.generatedFrom, to: generatedTo, active: true }),
    annotations: session.placement === 'replace' ? [Transaction.addToHistory.of(false)] : annotations,
  })
  session.generatedText += text
  session.generatedTo = generatedTo
  session.resultDocument = view.state.doc.toString()
  return true
}

function runHistoryCommand(view: EditorView | null, command: (target: EditorView) => boolean) {
  if (!view) return false
  view.focus()
  return command(view)
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, ariaLabel = 'Markdown editor', className = '', readOnly = false, mentionTerms = [], onMentionClick },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const mentionTermsRef = useRef(mentionTerms)
  const onMentionClickRef = useRef(onMentionClick)
  const activeGenerationRef = useRef<ActiveGeneration | null>(null)
  const latestGenerationRef = useRef<GenerationRecord | null>(null)
  const activeDictationRef = useRef<ActiveDictation | null>(null)
  const editableCompartmentRef = useRef(new Compartment())

  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onMentionClickRef.current = onMentionClick }, [onMentionClick])
  useEffect(() => {
    mentionTermsRef.current = mentionTerms
    viewRef.current?.dispatch({ effects: setMentionTerms.of(mentionTerms) })
  }, [mentionTerms])

  useImperativeHandle(ref, () => ({
    beginGeneration: (mode = 'generate', placement = 'append') => {
      const view = viewRef.current
      if (!view || activeGenerationRef.current) return null
      const session = beginGeneration(view, mode, latestGenerationRef.current, placement)
      if (!session) return null
      view.dispatch({ effects: setGenerationHighlight.of(null) })
      activeGenerationRef.current = session
      return { sceneText: session.preDocument, insertionPosition: session.insertionPosition }
    },
    appendGenerationChunk: (text) => {
      const view = viewRef.current
      const session = activeGenerationRef.current
      return Boolean(view && session && appendGenerationChunk(view, session, text))
    },
    finishGeneration: (status) => {
      const session = activeGenerationRef.current
      activeGenerationRef.current = null
      if (!session?.generatedText) return null
      if (session.placement === 'replace') {
        const view = viewRef.current
        if (!view) return null
        const generated = session.resultDocument
        const current = view.state.doc.toString()
        view.dispatch({ changes: { from: 0, to: current.length, insert: session.preDocument }, annotations: Transaction.addToHistory.of(false) })
        if (status === 'complete') {
          view.dispatch({
            changes: { from: 0, to: session.preDocument.length, insert: generated },
            effects: setGenerationHighlight.of({ from: 0, to: generated.length, active: false }),
            annotations: [Transaction.time.of(session.historyTime), Transaction.userEvent.of('input.type.generate'), isolateHistory.of('full')],
          })
          session.resultDocument = generated
        } else {
          view.dispatch({ effects: setGenerationHighlight.of(null), annotations: Transaction.addToHistory.of(false) })
          session.resultDocument = session.preDocument
        }
      }
      if (session.placement === 'append') viewRef.current?.dispatch({
          selection: { anchor: session.generatedTo },
          effects: setGenerationHighlight.of({ from: session.generatedFrom, to: session.generatedTo, active: false }),
          annotations: isolateHistory.of('before'),
        })
      const result: GenerationRecord = {
        preDocument: session.preDocument,
        sceneText: session.preDocument,
        insertionPosition: session.insertionPosition,
        resultDocument: session.resultDocument,
        generatedText: session.generatedText,
        status,
      }
      if (status === 'complete') latestGenerationRef.current = result
      return result
    },
    beginDictation: () => {
      const view = viewRef.current
      if (!view || activeGenerationRef.current || activeDictationRef.current || readOnly) return null
      const selection = view.state.selection.main
      const session: ActiveDictation = {
        id: `dictation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        preDocument: view.state.doc.toString(),
        from: selection.from,
        to: selection.to,
        provisional: '',
      }
      activeDictationRef.current = session
      view.dispatch({ effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(false)) })
      return session.id
    },
    updateDictation: (sessionId, transcript) => {
      const view = viewRef.current
      const session = activeDictationRef.current
      if (!view || !session || session.id !== sessionId) return false
      const next = dictationDocument(session, transcript)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next.document },
        selection: { anchor: next.cursor },
        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],
      })
      session.provisional = transcript
      return true
    },
    finishDictation: (sessionId, transcript) => {
      const view = viewRef.current
      const session = activeDictationRef.current
      if (!view || !session || session.id !== sessionId) return false
      if (session.provisional) view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: session.preDocument },
        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],
      })
      const insertion = dictationInsertion(session, transcript)
      view.dispatch({
        changes: { from: session.from, to: session.to, insert: insertion },
        selection: { anchor: session.from + insertion.length },
        annotations: [Transaction.userEvent.of('input.type.dictation'), isolateHistory.of('full')],
        effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)),
      })
      activeDictationRef.current = null
      view.focus()
      return true
    },
    cancelDictation: (sessionId) => {
      const view = viewRef.current
      const session = activeDictationRef.current
      if (!view || !session || session.id !== sessionId) return false
      if (view.state.doc.toString() !== session.preDocument) view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: session.preDocument },
        selection: { anchor: session.from, head: session.to },
        annotations: [Transaction.addToHistory.of(false), dictationProvisional.of(true)],
      })
      view.dispatch({ effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!readOnly)) })
      activeDictationRef.current = null
      return true
    },
    undo: () => runHistoryCommand(viewRef.current, undo),
    redo: () => runHistoryCommand(viewRef.current, redo),
  }), [])

  useEffect(() => {
    if (!hostRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: [
        markdown(),
        EditorState.readOnly.of(readOnly),
        editableCompartmentRef.current.of(EditorView.editable.of(!readOnly)),
        history(),
        keymap.of([...formattingKeymap(), ...defaultKeymap, ...historyKeymap]),
        livePreview,
        generationHighlightField,
        mentionField,
        EditorView.domEventHandlers({
          click: (event, view) => {
            if (event.button !== 0 || !view.state.selection.main.empty) return false
            const element = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-codex-mention') : null
            const key = element?.dataset.codexTerm
            const term = key ? mentionTermsRef.current.find((candidate) => candidate.key === key) : undefined
            if (!element || !term || !onMentionClickRef.current) return false
            const bounds = element.getBoundingClientRect()
            onMentionClickRef.current({ term, rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } })
            return false
          },
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'true' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())
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
    if (mentionTermsRef.current.length) view.dispatch({ effects: setMentionTerms.of(mentionTermsRef.current) })

    return () => {
      activeGenerationRef.current = null
      activeDictationRef.current = null
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [ariaLabel, readOnly])

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

  return <div ref={hostRef} className={`markdown-editor ${readOnly ? 'read-only' : ''} ${className}`.trim()} />
})

export default MarkdownEditor
