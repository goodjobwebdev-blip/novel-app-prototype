import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('../src/features/settings/SettingsSectionTabs.tsx', import.meta.url), 'utf8')
const tabPrimitive = readFileSync(new URL('../src/shared/ui/Tabs.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/features/settings/settings-section-tabs.css', import.meta.url), 'utf8')
const tabStyles = readFileSync(new URL('../src/shared/ui/feedback.css', import.meta.url), 'utf8')
const contextSectionsStart = app.indexOf('const contextSections')
const contextSectionsBlock = app.slice(contextSectionsStart, app.indexOf('\n]', contextSectionsStart) + 2)

test('Context Management exposes accessible tabs only for configurable context modes', () => {
  assert.match(contextSectionsBlock, /\['scene', 'Story'\][\s\S]*\['codex', 'Codex'\][\s\S]*\['chat', 'Chat'\]/)
  assert.doesNotMatch(contextSectionsBlock, /Summary|Note/)
  assert.match(app, /<SettingsSectionTabs tabs=\{contextSections\}[\s\S]*idPrefix="context" label="Context type"/)
  assert.match(tabs, /panelId: `\$\{idPrefix\}-panel-\$\{tab\}`/)
  assert.match(tabPrimitive, /role="tab"[\s\S]*aria-controls=\{item\.ariaControls \?\? item\.panelId\}[\s\S]*aria-selected=\{item\.value === value\}/)
  assert.match(app, /role="tabpanel"[\s\S]*aria-labelledby=\{`context-tab-/)
  assert.match(styles, /\.settings-section-tabs\.settings-section-tabs/)
  assert.match(tabStyles, /\.arc-tabs button\[aria-selected="true"\]/)
})

test('selected Context tab controls rendering and persistence without overwriting per-Chat profiles', () => {
  assert.match(app, /book\?\.contextType === 'codex' \|\| book\?\.contextType === 'chat' \? book\.contextType : 'scene'/)
  assert.doesNotMatch(app, /contextSection === 'summary'|contextSection === 'note'/)
  assert.match(app, /type=\{contextSection\}/)
  assert.match(app, /section === 'chat' && book\.chatId && chatContextProfile/)
  assert.match(app, /saveChatContextProfile\(book\.chatId, chatContextProfile\)/)
  assert.match(app, /setContextSettings\(value\)[\s\S]*setChatContextProfile\(chat\?\.contextProfile \?\? null\)/)
})

test('document-bound previews only receive the open document for the matching tab', () => {
  assert.match(app, /currentDocumentId=\{\(book\.contextType \?\? 'scene'\) === contextSection \? book\.currentDocumentId : undefined\}/)
  assert.match(app, /currentDocumentText=\{\(book\.contextType \?\? 'scene'\) === contextSection \? book\.currentDocumentText : undefined\}/)
})
