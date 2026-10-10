import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const baseStyles = readFileSync(new URL('../src/app/styles.css', import.meta.url), 'utf8')
const themeStyles = readFileSync(new URL('../src/features/settings/ui-settings.css', import.meta.url), 'utf8')

function declarationsFor(source, selector) {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(item => item.trim() === selector))
    .map(([, , declarations]) => declarations)
    .join(';')
}

function lastDeclaration(source, selector, property) {
  const declarations = declarationsFor(source, selector)
  return [...declarations.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))]
    .at(-1)?.[1].trim()
}

test('home, workspace, manuscript and both sidebars share the opaque theme canvas', () => {
  const styles = `${baseStyles}\n${themeStyles}`
  for (const selector of ['.app-shell', '.library-screen', '.workspace-screen', '.story-editor', '.settings-rail', '.book-panel']) {
    assert.equal(lastDeclaration(styles, selector, 'background'), 'var(--canvas)', `${selector} uses the theme canvas without transparency or a gradient`)
  }
})

test('the settings sidebar has no backdrop blur', () => {
  const declarations = declarationsFor(`${baseStyles}\n${themeStyles}`, '.settings-rail')
  assert.doesNotMatch(declarations, /(?:-webkit-)?backdrop-filter\s*:/)
})

test('editor internals stay transparent while dialogs retain their elevated surface', () => {
  for (const selector of ['.markdown-editor .cm-editor', '.markdown-editor .cm-scroller', '.markdown-editor .cm-content']) {
    assert.equal(lastDeclaration(themeStyles, selector, 'background'), 'transparent')
  }
  for (const selector of ['.expandable-text-dialog', '.generation-details-dialog']) {
    assert.equal(lastDeclaration(themeStyles, selector, 'background'), 'var(--surface)')
  }
})
