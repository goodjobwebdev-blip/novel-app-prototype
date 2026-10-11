import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
const contextSectionsStart = app.indexOf('const contextSections')
const contextSectionsBlock = app.slice(contextSectionsStart, app.indexOf('\n]', contextSectionsStart) + 2)

test('Context Management exposes accessible tabs only for configurable context modes', () => {
  assert.match(contextSectionsBlock, /\['scene', 'Story'\][\s\S]*\['codex', 'Codex'\][\s\S]*\['chat', 'Chat'\]/)
  assert.doesNotMatch(contextSectionsBlock, /Summary|Note/)
  assert.match(app, /<SettingsSectionTabs tabs=\{ownerKind === 'world' \? contextSections\.filter\(\(\[id\]\) => id !== 'scene'\) : contextSections\}[\s\S]*idPrefix="context" label="Context type"/)
  assert.match(app, /role="tabpanel"[\s\S]*aria-labelledby=\{`context-tab-/)
})

test('selected Context tab controls rendering and persistence without overwriting per-Chat profiles', () => {
  assert.match(app, /book\?\.contextType === 'codex' \|\| book\?\.contextType === 'chat' \? book\.contextType : ownerKind === 'world' \? 'codex' : 'scene'/)
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
