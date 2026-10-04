import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const app = readFileSync
(new URL('../src/app/App.tsx', import.meta.url), 'utf8')
const profiles = readFileSync(new URL('../src/features/settings/SettingsProfilesPanel.tsx', import.meta.url), 'utf8')
const appearance = readFileSync(new URL('../src/features/settings/UiSettingsPortal.tsx', import.meta.url), 'utf8')
const settingsTabs = readFileSync(new URL('../src/features/settings/SettingsSectionTabs.tsx', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('../src/shared/ui/Tabs.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/features/settings/settings-section-tabs.css', import.meta.url), 'utf8')

test('settings subsections delegate to the shared Tabs component and visual treatment', () => {
  assert.match(profiles, /<SettingsSectionTabs tabs=\{globalAiSections\}[\s\S]*idPrefix="ai" label="AI sections"/)
  assert.match(app, /<SettingsSectionTabs tabs=\{contextSections\}[\s\S]*idPrefix="context" label="Context type"/)
  assert.match(appearance, /<SettingsSectionTabs tabs=\{appearanceSections\}[\s\S]*idPrefix="appearance" label="Appearance sections"/)
  assert.match(settingsTabs, /import Tabs from '\.\.\/\.\.\/shared\/ui\/Tabs'/)
  assert.match(settingsTabs, /return <Tabs[\s\S]*className="settings-section-tabs"[\s\S]*items=\{tabs\.map/)
  assert.doesNotMatch(app, /className="ai-section-nav"|className="context-section-tabs"/)
  assert.match(styles, /\.settings-section-tabs/)
})

test('shared settings tabs inherit accessible selection and keyboard navigation from Tabs', () => {
  assert.match(settingsTabs, /value: tab[\s\S]*id: `\$\{idPrefix\}-tab-\$\{tab\}`[\s\S]*panelId: `\$\{idPrefix\}-panel-\$\{tab\}`/)
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /role="tab"/)
  assert.match(tabs, /aria-controls=\{item\.ariaControls \?\? item\.panelId\}/)
  assert.match(tabs, /aria-selected=\{item\.value === value\}/)
  assert.match(tabs, /tabIndex=\{item\.value === value \? 0 : -1\}/)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(tabs, new RegExp(`event\\.key === '${key}'`))
})

test('each settings tab controls a labelled panel', () => {
  for (const [panel, tab] of [
    ['ai-panel-connection', 'ai-tab-connection'],

    ['appearance-panel-theme', 'appearance-tab-theme'],
    ['appearance-panel-typography', 'appearance-tab-typography'],
    ['appearance-panel-editor', 'appearance-tab-editor'],
  ]) {
    assert.match(`${app}\n${profiles}\n${appearance}`, new RegExp(`role="tabpanel"[^>]*id="${panel}"[^>]*aria-labelledby="${tab}"|role="tabpanel"[^>]*aria-labelledby="${tab}"[^>]*id="${panel}"`))
  }
  assert.match(profiles, /role=\{section === 'ai' \? 'tabpanel' : undefined\}/)
  assert.match(profiles, /id=\{section === 'ai' \? `ai-panel-\$\{aiSection\}` : undefined\}/)
  assert.match(profiles, /aria-labelledby=\{section === 'ai' \? `ai-tab-\$\{aiSection\}` : undefined\}/)
  assert.match(profiles, /\['models', 'Models'\], \['prompts', 'Prompts'\]/)
  assert.match(app, /role="tabpanel" id=\{`context-panel-\$\{contextSection\}`\} aria-labelledby=\{`context-tab-\$\{contextSection\}`\}/)
})
