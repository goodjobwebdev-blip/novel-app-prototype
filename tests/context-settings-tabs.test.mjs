import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/context-settings-ux.css', import.meta.url), 'utf8')

test('Context Management exposes explicit accessible tabs for every existing context mode', () => {
  assert.match(app, /const contextSections:[\s\S]*\['scene', 'Story'\][\s\S]*\['codex', 'Codex'\][\s\S]*\['chat', 'Chat'\][\s\S]*\['summary', 'Summary'\][\s\S]*\['note', 'Note'\]/)
  assert.match(app, /className="context-section-tabs" role="tablist"/)
  assert.match(app, /role="tab"[\s\S]*aria-controls=\{`context-panel-[\s\S]*aria-selected=\{active === section\}/)
  assert.match(app, /role="tabpanel"[\s\S]*aria-labelledby=\{`context-tab-/)
  assert.match(styles, /\.context-section-tabs button\.active/)
})

test('selected Context tab controls rendering and persistence without overwriting per-Chat profiles', () => {
  assert.match(app, /contextSection === 'summary'/)
  assert.match(app, /contextSection === 'note'/)
  assert.match(app, /type=\{contextSection\}/)
  assert.match(app, /section === 'chat' && book\.chatId && chatContextProfile/)
  assert.match(app, /saveChatContextProfile\(book\.chatId, chatContextProfile\)/)
  assert.match(app, /setContextSettings\(value\)[\s\S]*setChatContextProfile\(chat\?\.contextProfile \?\? null\)/)
})

test('document-bound previews only receive the open document for the matching tab', () => {
  assert.match(app, /currentDocumentId=\{\(book\.contextType \?\? 'scene'\) === contextSection \? book\.currentDocumentId : undefined\}/)
  assert.match(app, /currentDocumentText=\{\(book\.contextType \?\? 'scene'\) === contextSection \? book\.currentDocumentText : undefined\}/)
})
