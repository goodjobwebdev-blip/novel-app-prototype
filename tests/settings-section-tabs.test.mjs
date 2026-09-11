import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const app = readFileSync
(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appearance = readFileSync(new URL('../src/UiSettingsPortal.tsx', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('../src/SettingsSectionTabs.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/settings-section-tabs.css', import.meta.url), 'utf8')

test('settings subsections share one tab component and visual treatment', () => {
  assert.match(app, /<SettingsSectionTabs tabs=\{aiSections\}[\s\S]*idPrefix="ai" label="AI sections"/)
  assert.match(app, /<SettingsSectionTabs tabs=\{contextSections\}[\s\S]*idPrefix="context" label="Context type"/)
  assert.match(appearance, /<SettingsSectionTabs tabs=\{appearanceSections\.map[\s\S]*idPrefix="appearance" label="Appearance sections"/)
  assert.doesNotMatch(app, /className="ai-section-nav"/)
  assert.doesNotMatch(app, /className="context-section-tabs"/)
  assert.match(styles, /\.settings-section-tabs/)
})

test('shared settings tabs expose accessible selection and keyboard navigation', () => {
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /role="tab"/)
  assert.match(tabs, /aria-selected=\{active === tab\}/)
  assert.match(tabs, /tabIndex=\{active === tab \? 0 : -1\}/)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(tabs, new RegExp(`event\\.key === '${key}'`))
})

test('each settings tab controls a labelled panel', () => {
  for (const panel of ['ai-panel-connection', 'ai-panel-models', 'ai-panel-prompts', 'context-panel-', 'appearance-panel-theme', 'appearance-panel-typography', 'appearance-panel-customization']) {
    assert.match(`${app}\n${appearance}`, new RegExp(panel))
  }
})
