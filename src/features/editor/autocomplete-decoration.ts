import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { protectedRanges } from './document-projection'
import type { EditorSelectionSnapshot } from './MarkdownEditor'

type AutocompleteSuggestion = { snapshot: EditorSelectionSnapshot; text: string }
type AutocompleteDecoration = AutocompleteSuggestion & { decorations: DecorationSet }

export const setAutocompleteDecoration = StateEffect.define<AutocompleteSuggestion | null>()

class AutocompleteWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: AutocompleteWidget) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-autocomplete-ghost'
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    span.setAttribute('contenteditable', 'false')
    return span
  }
  ignoreEvent() { return true }
}

export const autocompleteDecorationField = StateField.define<AutocompleteDecoration | null>({
  create: () => null,
  update(value, transaction) {
    // Clearing here, rather than dispatching from an update listener, also keeps
    // old suggestions out of history restoration and mapped cursor positions.
    if (transaction.docChanged || transaction.selection) return null
    for (const effect of transaction.effects) {
      if (!effect.is(setAutocompleteDecoration)) continue
      if (!effect.value) return null
      const { snapshot, text } = effect.value
      value = { snapshot, text, decorations: Decoration.set([
        Decoration.widget({ widget: new AutocompleteWidget(text), side: 1 }).range(snapshot.from),
      ]) }
    }
    return value
  },
  provide: field => EditorView.decorations.from(field, value => value?.decorations ?? Decoration.none),
})

export function sameAutocompleteSnapshot(left: EditorSelectionSnapshot, right: EditorSelectionSnapshot) {
  return left.editorId === right.editorId && left.revision === right.revision && left.document === right.document
    && left.from === right.from && left.to === right.to && left.text === right.text
    && left.autocompleteEpoch === right.autocompleteEpoch
}

export function autocompletePositionBlocked(state: EditorState) {
  const position = state.selection.main.head
  const document = state.doc.toString()
  // Include the end boundary: an unterminated protected block/code region ends
  // at EOF, precisely where autocomplete would otherwise be offered.
  if (protectedRanges(document).some(range => range.from < position && range.to >= position)) return true
  let blocked = false
  // Parse the full source, not the potentially partial viewport syntax tree.
  markdownLanguage.parser.parse(document).iterate({ enter(node) {
    if (node.from < position && node.to >= position && /Code|HTMLBlock|HTMLTag|Comment|ProcessingInstruction/.test(node.name)) blocked = true
  } })
  return blocked
}
