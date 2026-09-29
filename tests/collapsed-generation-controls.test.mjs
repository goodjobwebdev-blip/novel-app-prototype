import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspace = readFileSync(new URL('../src/app/Workspace.tsx', import.meta.url), 'utf8')
const composerStyles = readFileSync(new URL('../src/features/chat/composer.css', import.meta.url), 'utf8')

function generateControlSource() {
  const start = workspace.indexOf('function GenerateControl(')
  const end = workspace.indexOf('\nfunction AutotitlePanel(', start)
  assert.ok(start >= 0 && end > start, 'GenerateControl source is available')
  return workspace.slice(start, end)
}

test('collapsed composer owns a single transient activity status and keeps editor dictation visible', () => {
  const control = generateControlSource()

  assert.match(workspace, /strip=\{drawerCollapsed \? null :/)
  assert.doesNotMatch(workspace, /composer-collapsed-status/)
  assert.match(control, /drawerCollapsed && isGenerating && phase[\s\S]*GenerationActivityStrip[\s\S]*collapsed-dictation-button[\s\S]*disabled[\s\S]*generation-stop-circle/)
  assert.match(control, /if \(drawerCollapsed\) return[\s\S]*collapsed-dictation-button[\s\S]*onClick=\{onMicro\}[\s\S]*GenerationActions/)
  assert.match(control, /id: 'editor', label: 'Dictate editor'/)
})

test('collapsed dictation reuses the activity slot and preserves stable controls', () => {
  const control = generateControlSource()

  assert.match(control, /collapsed-dictation-mode[\s\S]*dictation-activity-strip[\s\S]*formatGenerationTime\(speechElapsed\)/)
  assert.match(control, /sttRecording \? stopSttSession : sttPermissionPending \? cancelSttSession : undefined/)
  assert.match(control, /Cancel microphone permission request/)
  assert.match(control, /Generate unavailable during dictation/)
  assert.match(composerStyles, /\.workspace-composer \.generate-control-shell:not\(\.mode\) \{ height: 56px; min-height: 56px; \}/)
  assert.match(composerStyles, /\.workspace-composer \.collapsed-dictation-button \{ width: 44px; height: 44px; min-width: 44px;/)
})
