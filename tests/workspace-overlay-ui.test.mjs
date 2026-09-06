import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspace = readFileSync(new URL('../src/Workspace.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const ttsStyles = readFileSync(new URL('../src/tts.css', import.meta.url), 'utf8')
const autotitleStyles = readFileSync(new URL('../src/autotitle.css', import.meta.url), 'utf8')
const codexMentionStyles = readFileSync(new URL('../src/codex-mentions.css', import.meta.url), 'utf8')

function zIndex(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`))
  assert.ok(match, `${selector} has an explicit z-index`)
  return Number(match[1])
}

test('outline TTS status renders above the open book workspace', () => {
  assert.ok(zIndex(ttsStyles, '.tts-status') > zIndex(styles, '.book-panel'))
})

test('autotitle is a portaled modal above workspace panels', () => {
  const start = workspace.indexOf('function AutotitlePanel(')
  const end = workspace.indexOf('\nfunction GenerationDetailsDialog(', start)
  assert.ok(start >= 0 && end > start, 'AutotitlePanel block exists')
  const panel = workspace.slice(start, end)
  assert.match(panel, /createPortal\(/)
  assert.match(panel, /className="autotitle-backdrop"/)
  assert.match(panel, /aria-modal="true"/)
  assert.ok(zIndex(autotitleStyles, '.autotitle-backdrop') > zIndex(styles, '.book-panel'))
})

test('mobile Codex preview uses a bounded bottom sheet and scoped typography', () => {
  assert.match(codexMentionStyles, /\.codex-mention-popover \{ left: 10px !important; right: 10px; top: auto !important; bottom:/)
  assert.match(codexMentionStyles, /\.codex-mention-markdown h1, \.codex-mention-markdown h2, \.codex-mention-markdown h3/)
  assert.match(codexMentionStyles, /\.codex-mention-close \{ appearance: none;/)
  assert.match(workspace, /firstHeading\?\.localeCompare\(title\.trim\(\), undefined, \{ sensitivity: 'base' \}\) === 0/)
})
