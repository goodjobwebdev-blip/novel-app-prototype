import test from 'node:test'
import assert from 'node:assert/strict'
import { contrastRatio, contrastWarnings } from '../src/appearance-utils.ts'
import { createCustomTheme, defaultUiSettings, saveUiSettings } from '../src/ui-settings.ts'
test('contrast calculations distinguish identical colors and black/white with symmetric ratios', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
  assert.equal(contrastRatio('#777777', '#777777'), 1)
  assert.equal(contrastWarnings({ text:'#000000', editor:'#ffffff', elevated:'#ffffff', muted:'#ffffff', selection:'#ffffff', accent:'#000000', error:'#000000' }).some(item=>item.label === 'Secondary text'), true)
})
test('duplicating creates an independent palette without mutating the original settings', () => {
  const next = createCustomTheme(defaultUiSettings)
  next.customThemes[0].palette.text = '#000000'
  assert.equal(defaultUiSettings.customThemes.length, 0)
  assert.equal(defaultUiSettings.activeThemeId, 'very-dark')
})
test('failed storage writes do not announce success or apply a theme', () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  let events=0, applied=0
  globalThis.window = { localStorage: { setItem(){throw new Error('Storage full')} }, dispatchEvent(){events++} }
  globalThis.document = { documentElement: { dataset: {}, style: {setProperty(){applied++}} } }
  try { assert.throws(()=>saveUiSettings(defaultUiSettings), /Storage full/); assert.equal(events,0); assert.equal(applied,0) }
  finally { globalThis.window=previousWindow; globalThis.document=previousDocument }
})
