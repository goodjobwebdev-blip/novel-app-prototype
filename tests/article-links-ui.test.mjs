import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/' })
after(() => dom.window.close())
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.article-links-ui-', import.meta.url))
after(() => rmSync(directory, { recursive: true, force: true }))
buildSync({ entryPoints: [new URL('../src/features/codex/ArticleLinks.tsx', import.meta.url).pathname], jsx: 'automatic', bundle: true, packages: 'external', format: 'esm', outfile: `${directory}/article-links.mjs`, loader: { '.css': 'empty' }, logLevel: 'silent' })
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: ArticleLinks } = await import(pathToFileURL(`${directory}/article-links.mjs`))
const h = React.createElement
const entry = (id, title, overrides = {}) => ({ id, title, type: 'codexEntry', bookId: 'book', parentId: 'book', category: 'Place', content: '', createdAt: 1, updatedAt: 1, ...overrides })
const select = () => document.querySelector('select[aria-label="Link to article"]')
const insertButton = () => document.querySelector('button[aria-label="Insert article link"]')
const groupButtons = label => [...document.querySelectorAll(`section[aria-label="${label}"] button`)]
async function choose(id) {
  assert.equal(select().disabled, false)
  await act(async () => { select().value = id; select().dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
async function mount(t, overrides = {}) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const props = { entry: entry('current', 'Current article'), content: '', entries: [], disabled: false, onInsert() {}, onOpen() {}, ...overrides }
  await act(async () => root.render(h(ArticleLinks, props)))
  const disclosure = document.querySelector('details.codex-article-links')
  assert.ok(disclosure, 'Article links uses the shared Disclosure card')
  assert.equal(disclosure.open, false)
  await act(async () => disclosure.querySelector('summary').click())
  assert.equal(disclosure.open, true)
  return { root, props, disclosure }
}

test('Article links uses a collapsible card, a labeled shared Select, and an accessible plus button', async t => {
  const { disclosure } = await mount(t)

  assert.equal(disclosure.querySelector('summary strong').textContent, 'Article links')
  assert.equal(disclosure.getAttribute('aria-label'), 'Article links and backlinks')
  const field = select().closest('label')

  assert.equal(field.htmlFor, select().id)
  assert.equal(field.querySelector('.arc-field__label').textContent, 'Link to article')

  assert.equal(select().options[0].textContent, 'Choose article')

  assert.equal(insertButton().textContent, '')
  assert.equal(insertButton().disabled, true)
  assert.equal(document.querySelector('.codex-article-links__help').textContent, 'Links still work after you rename an article.')
  assert.equal(document.querySelector('section[aria-label="Linked articles"]').textContent, 'Linked articlesNo article links.')
  assert.equal(document.querySelector('section[aria-label="Article backlinks"]').textContent, 'BacklinksNo backlinks.')
  await act(async () => disclosure.querySelector('summary').click())
  assert.equal(disclosure.open, false)
})

test('insertion escapes the current title, preserves permanent IDs, and navigation survives renaming', async t => {
  const current = entry('current', 'Current article')
  const target = entry('permanent(id)', 'Harbor [north]')
  const backlink = entry('backlink', 'Traveler', { content: '[Current article](arc-codex:current)' })
  const inserted = [], opened = []
  const { root, props } = await mount(t, {
    entry: current, entries: [current, target, backlink],
    content: '[Old harbor name](arc-codex:permanent%28id%29) [Missing](arc-codex:missing)',
    onInsert: markdown => inserted.push(markdown), onOpen: id => opened.push(id),
  })
  assert.deepEqual([...select().options].map(option => option.value), ['', target.id, backlink.id])
  await choose(target.id)
  assert.equal(insertButton().disabled, false)
  await act(async () => insertButton().click())
  assert.deepEqual(inserted, ['[Harbor \\[north\\]](arc-codex:permanent%28id%29)'])
  assert.deepEqual(groupButtons('Linked articles').map(button => button.textContent), [target.title, 'Unavailable article'])
  assert.equal(groupButtons('Linked articles')[1].disabled, true)
  await act(async () => groupButtons('Linked articles')[1].click())
  assert.deepEqual(opened, [])
  await act(async () => groupButtons('Linked articles')[0].click())
  await act(async () => groupButtons('Article backlinks')[0].click())
  assert.deepEqual(opened, [target.id, backlink.id])

  const renamed = { ...target, title: 'Renamed harbor' }
  await act(async () => root.render(h(ArticleLinks, { ...props, entries: [current, renamed, backlink] })))
  assert.equal(groupButtons('Linked articles')[0].textContent, renamed.title)
  await act(async () => insertButton().click())
  await act(async () => groupButtons('Linked articles')[0].click())
  assert.equal(inserted[1], '[Renamed harbor](arc-codex:permanent%28id%29)')
  assert.equal(opened[2], target.id)
})

test('disabled insertion leaves outgoing links and backlinks available to open', async t => {
  const target = entry('target', 'Harbor', { content: '[Current](arc-codex:current)' })
  const inserted = [], opened = []
  const { root, props } = await mount(t, { entries: [target], content: '[Harbor](arc-codex:target)', onInsert: value => inserted.push(value), onOpen: id => opened.push(id) })
  await choose(target.id)
  await act(async () => root.render(h(ArticleLinks, { ...props, disabled: true })))
  assert.equal(select().disabled, true)
  assert.equal(insertButton().disabled, true)
  await act(async () => insertButton().click())
  assert.deepEqual(inserted, [])
  assert.equal(groupButtons('Linked articles')[0].disabled, false)
  assert.equal(groupButtons('Article backlinks')[0].disabled, false)
  await act(async () => groupButtons('Linked articles')[0].click())
  await act(async () => groupButtons('Article backlinks')[0].click())
  assert.deepEqual(opened, [target.id, target.id])
})

test('World filtering hides private and other-World titles and invalidates a previously selected private target', async t => {
  const current = entry('current', 'Current article')
  const worldCurrent = { ...current, bookId: 'world', parentId: 'world', worldId: 'world' }
  const shared = entry('shared', 'Shared harbor', { bookId: 'world', worldId: 'world', content: '[Current](arc-codex:current)' })
  const privateArticle = entry('private', 'Private secret', { content: '[Current](arc-codex:current)' })
  const bookOverride = entry('override', 'Private World override', { worldId: 'world', content: '[Current](arc-codex:current)' })
  const otherWorld = entry('other', 'Other World secret', { bookId: 'other-world', worldId: 'other-world', content: '[Current](arc-codex:current)' })
  const inserted = [], opened = []
  const { root, props } = await mount(t, {
    entry: current, entries: [current, shared, privateArticle, bookOverride, otherWorld],
    content: '[Shared](arc-codex:shared) [Private](arc-codex:private) [Override](arc-codex:override) [Other](arc-codex:other)',
    onInsert: value => inserted.push(value), onOpen: id => opened.push(id),
  })
  await choose(privateArticle.id)
  assert.equal(insertButton().disabled, false)
  await act(async () => root.render(h(ArticleLinks, { ...props, entry: worldCurrent, entries: [worldCurrent, shared, privateArticle, bookOverride, otherWorld] })))
  assert.deepEqual([...select().options].map(option => option.value), ['', shared.id])
  assert.equal(insertButton().disabled, true)
  await act(async () => insertButton().click())
  assert.deepEqual(inserted, [])
  assert.deepEqual(groupButtons('Linked articles').map(button => [button.textContent, button.disabled]), [
    [shared.title, false], ['Unavailable article', true], ['Unavailable article', true], ['Unavailable article', true],
  ])
  assert.deepEqual(groupButtons('Article backlinks').map(button => button.textContent), [shared.title])
  for (const hidden of [privateArticle, bookOverride, otherWorld]) assert.equal(document.body.textContent.includes(hidden.title), false)
  await choose(shared.id)
  await act(async () => insertButton().click())
  await act(async () => groupButtons('Article backlinks')[0].click())
  assert.deepEqual(inserted, ['[Shared harbor](arc-codex:shared)'])
  assert.deepEqual(opened, [shared.id])
})
