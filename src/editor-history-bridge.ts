import { redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'

function findEditorView() {
  const editor = document.querySelector<HTMLElement>('.markdown-editor .cm-editor')
  return editor ? EditorView.findFromDOM(editor) : null
}

function runHistoryAction(action: 'undo' | 'redo') {
  const view = findEditorView()
  if (!view) return
  view.focus()
  ;(action === 'undo' ? undo : redo)(view)
}

document.addEventListener('pointerdown', (event) => {
  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLButtonElement>('button[aria-label="Undo editor change"], button[aria-label="Redo editor change"]')
  if (!button) return

  event.preventDefault()
  event.stopPropagation()
  runHistoryAction(button.getAttribute('aria-label')?.startsWith('Undo') ? 'undo' : 'redo')
}, true)
