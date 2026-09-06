import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/PromptTemplateEditor.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../src/ChatFeature.tsx', import.meta.url), 'utf8')

test('prompt settings use the CodeMirror editor with live diagnostics and caret insertion', () => {
  assert.match(app, /<PromptTemplateEditor/)
  assert.match(app, /diagnostics=\{activePromptDiagnostics\}/)
  assert.match(app, /promptEditorRef\.current\?\.insert/)
  assert.match(editor, /new EditorView/)
  assert.match(editor, /cm-prompt-error/)
  assert.match(editor, /aria-invalid/)
})

test('invalid templates remain editable but block every current text-generation scope', () => {
  assert.match(app, /generation is blocked/)
  assert.match(app, /Request blocked by an invalid/)
  assert.match(workspace, /const compositionScope = isCodex \? 'lore' : 'story'/)
  assert.match(workspace, /assertPromptTemplateValid\(composition\.systemPrompt, compositionScope\)/)
  assert.match(workspace, /composition\.predefinedMessages\.filter/)
  assert.match(workspace, /assertPromptTemplateValid\(settings\.prompts\.summarize, 'summarize'\)/)
  assert.match(chat, /promptTemplateDiagnostics\(template, 'assistant'\)/)
  assert.match(chat, /Fix the invalid Chat composition/)
})
