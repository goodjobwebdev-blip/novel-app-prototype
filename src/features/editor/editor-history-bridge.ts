import { historyField } from '@codemirror/commands'
import { EditorState, type EditorSelection, type EditorStateConfig } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

type SavedHistory = { document: string; selection: EditorSelection; history: unknown }
const savedStates = new Map<string, SavedHistory>()

function remember(key: string, state: EditorState) {
  savedStates.set(key, { document: state.doc.toString(), selection: state.selection, history: state.field(historyField) })
}

/** Restore history into fresh extensions so callbacks belong to this editor. */
export function createEditorStateWithHistory(config: EditorStateConfig, key?: string) {
  if (!key) return EditorState.create(config)
  const saved = savedStates.get(key)
  const source = typeof config.doc === 'string' ? config.doc : config.doc?.toString() ?? ''
  const matching = saved?.document === source ? saved : undefined
  if (saved && !matching) savedStates.delete(key)

  const state = EditorState.create({
    ...config,
    selection: config.selection ?? matching?.selection,
    extensions: [
      config.extensions ?? [],
      matching ? historyField.init(() => matching.history) : [],
      EditorView.updateListener.of(update => remember(key, update.state)),
    ],
  })
  remember(key, state)
  return state
}
