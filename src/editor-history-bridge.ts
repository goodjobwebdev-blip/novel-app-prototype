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
  const button = target?.closest<HTMLButtonElement>('.generate-actions button')
  if (!button) return

  const label = button.getAttribute('aria-label') ?? ''

  event.preventDefault()
  event.stopPropagation()

  if (label === 'Undo editor change') {
    runHistoryAction('undo')
    return
  }

  if (label === 'Redo editor change') {
    runHistoryAction('redo')
    return
  }

  button.click()
}, true)
