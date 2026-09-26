import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const savedStates = new Map<string, EditorState>()
const trackedViews = new WeakSet<EditorView>()
const historyPersistenceMarker = StateField.define<boolean>({
  create: () => true,
  update: (value) => value,
})

function editorKey(view: EditorView) {
  const storyEditor = view.dom.closest<HTMLElement>('.story-editor')
  const documentPath = storyEditor?.querySelector<HTMLElement>('.document-path')?.textContent?.trim() ?? ''
  const documentTitle = storyEditor?.querySelector<HTMLElement>('.document-titlebar h1')?.textContent?.trim() ?? ''
  const ariaLabel = view.contentDOM.getAttribute('aria-label')?.trim() ?? 'Markdown editor'
  return [documentPath, documentTitle, ariaLabel].filter(Boolean).join('\u241f')
}

function persistViewState(view: EditorView, key: string) {
  savedStates.set(key, view.state)
}

function trackEditor(view: EditorView) {
  if (trackedViews.has(view)) return
  trackedViews.add(view)

  const key = editorKey(view)
  const savedState = savedStates.get(key)
  if (savedState && savedState.doc.toString() === view.state.doc.toString()) {
    view.setState(savedState)
  } else if (savedState) {
    savedStates.delete(key)
  }

  if (!view.state.field(historyPersistenceMarker, false)) {
    view.dispatch({
      effects: StateEffect.appendConfig.of([
        historyPersistenceMarker,
        EditorView.updateListener.of((update) => persistViewState(update.view, key)),
      ]),
    })
  }

  persistViewState(view, key)
}

function trackMountedEditors() {
  document.querySelectorAll<HTMLElement>('.markdown-editor .cm-editor').forEach((editor) => {
    const view = EditorView.findFromDOM(editor)
    if (view) trackEditor(view)
  })
}

const observer = new MutationObserver(trackMountedEditors)
observer.observe(document.documentElement, { childList: true, subtree: true })
queueMicrotask(trackMountedEditors)
