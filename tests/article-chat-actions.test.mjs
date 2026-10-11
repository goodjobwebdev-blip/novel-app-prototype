import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Event', 'CustomEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const directory = mkdtempSync(new URL('../node_modules/.article-chat-test-', import.meta.url))
transpileSourceTree(directory)
const at = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const p = await at('data/persistence')
const db = await p.database()
await p.ensurePrototypeSeed('demo')
const worlds = await at('features/worlds/world-service')
const chatService = await at('features/chat/chat-service')
const tools = await at('features/chat/chat-tools')
const links = await at('features/codex/codex-article-links')
const { default: ArticleLinks } = await at('features/codex/ArticleLinks')
const { default: ChatArticleContext } = await at('features/chat/ChatArticleContext')
const { default: ArticleAnswerActions } = await at('features/chat/ArticleAnswerActions')
const { MarkdownMessage } = await at('features/chat/ChatFeature')
const { assembleChatGenerationRequest } = await at('features/chat/chat-request')
const { buildContextValues } = await at('shared/context/context-service')
after(() => { db.close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) if (table.name !== 'meta') await table.clear() })
  localStorage.clear(); sessionStorage.clear()
})
async function mount(t, component, props) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const render = async next => { await act(async () => root.render(React.createElement(component, next))) }
  await render(props)
  return render
}
async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    let ready
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); ready = await predicate() })
    if (ready) return
  }
  assert.fail(document.body.textContent)
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function click(text) { assert.ok(button(text), text); assert.equal(button(text).disabled, false); await act(async () => button(text).click()) }
async function select(value) {
  const field = document.querySelector('select[aria-label="Target article"]') || document.querySelector('select')
  await act(async () => { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function fixture() {
  const world = await worlds.createWorld('World without a Book')
  const chat = await chatService.createChat(world.id)
  const first = await p.createCodexEntry(world.id, 'First article', 'lore-other')
  const second = await p.createCodexEntry(world.id, 'Second article', 'lore-other')
  await p.saveDocumentContent(first.id, 'Original body')
  await p.saveDocumentContent(second.id, 'Second body')
  const entry = await p.getEntity(first.id)
  const other = await p.getEntity(second.id)
  const message = await chatService.createChatMessage(chat, 'assistant', 'Answer body')
  return { world, chat, entry, other, message }
}
test('article IDs round-trip parentheses and escaped labels, ignoring code and image links', () => {
  const id = 'permanent(id)/é'
  const markdown = links.articleLink(id, 'A [renamed] article')
  assert.deepEqual(links.articleLinkIds(markdown), [id])
  assert.deepEqual(links.articleLinkIds('`[code](arc-codex:no)`\n\n```md\n[code](arc-codex:no)\n```\n\n![image](arc-codex:no)\n' + markdown), [id])
})
test('Chat renders permanent article links as workspace navigation without allowing unsafe URL schemes', async t => {
  const opened = []
  await mount(t, MarkdownMessage, { content: '[Renamed article](arc-codex:permanent%28id%29) [website](https://example.com) [unsafe](javascript:alert%281%29)', onArticleLink: id => opened.push(id) })
  await click('Renamed article')
  assert.deepEqual(opened, ['permanent(id)'])
  assert.equal(document.querySelector('a[href="https://example.com"]')?.textContent, 'website')
  assert.equal(document.querySelector('a[href^="javascript:"]'), null)
})
test('World link navigation never exposes private Book backlinks', async t => {
  const f = await fixture()
  const privateEntry = { ...f.other, id: 'private', bookId: 'private-book', worldId: undefined, title: 'PRIVATE', content: links.articleLink(f.entry.id, f.entry.title) }
  const shared = { ...f.other, title: 'Renamed second article', content: links.articleLink(f.entry.id, f.entry.title) }
  const opened = []
  await mount(t, ArticleLinks, { entry: f.entry, content: links.articleLink(shared.id, 'Old second title'), entries: [f.entry, shared, privateEntry], disabled: false, onInsert() {}, onOpen: id => opened.push(id) })
  assert.equal(document.body.textContent.includes('PRIVATE'), false)
  await click(shared.title)
  assert.deepEqual(opened, [shared.id])
})
test('adding the current article is explicit and remains visibly pinned after editor selection changes and remount', async t => {
  const f = await fixture()
  let current = f.chat
  let props
  let render
  const onChange = next => { current = next; props = { ...props, chat: next } }
  props = { chat: current, currentArticleId: f.entry.id, disabled: false, onChange }
  render = await mount(t, ChatArticleContext, props)
  await settle(() => button('Add current article to context'))
  assert.deepEqual(current.contextProfile.codexEntryIds, [])
  await click('Add current article to context')
  await settle(() => current.contextProfile.codexEntryIds.includes(f.entry.id))
  props = { ...props, currentArticleId: f.other.id }
  await render(props)
  assert.match(document.querySelector('.chat-article-context').textContent, /First article/)
  assert.deepEqual((await chatService.getChat(f.chat.id)).contextProfile.codexEntryIds, [f.entry.id])
  await render({ ...props, key: 'restored-chat', chat: await chatService.getChat(f.chat.id) })
  await settle(() => /1 selected/.test(document.querySelector('.chat-article-context').textContent))
})
test('World Chat request assembly cannot interpolate metadata from the last Book', async () => {
  const f = await fixture()
  const context = await buildContextValues({ bookId: f.world.id, type: 'chat', profile: f.chat.contextProfile })
  const book = Object.fromEntries(['title', 'series', 'seriesOrder', 'overview', 'genre', 'style', 'pov', 'tense', 'language'].map(key => [key, 'PRIVATE_BOOK_SECRET']))
  const request = assembleChatGenerationRequest({ scope: 'world', book, context, history: [{ role: 'user', content: 'Hello World' }], composition: { systemPrompt: '{{book.title}} {{book.overview}} {{book.pov}} {{chat.workspace_instructions}}', predefinedMessages: [] }, tools: [] })
  assert.equal(JSON.stringify(request).includes('PRIVATE_BOOK_SECRET'), false)
  assert.match(JSON.stringify(request), /World/)
})
test('concurrent explicit source additions preserve both IDs and reject foreign articles', async () => {
  const f = await fixture()
  await Promise.all([
    chatService.setChatArticleIncluded(f.chat.id, f.entry.id, true),
    chatService.setChatArticleIncluded(f.chat.id, f.other.id, true),
  ])
  assert.deepEqual(new Set((await chatService.getChat(f.chat.id)).contextProfile.codexEntryIds), new Set([f.entry.id, f.other.id]))
  const foreignWorld = await worlds.createWorld('Other World')
  const foreign = await p.createCodexEntry(foreignWorld.id, 'Foreign', 'lore-other')
  await assert.rejects(chatService.setChatArticleIncluded(f.chat.id, foreign.id, true), /available/)
})
test('append previews flush editor changes first and require a separate durable approval', async t => {
  const f = await fixture()
  let flushed = false
  await mount(t, ArticleAnswerActions, { ...f, content: 'Answer body', disabled: false, onSaved: async () => {}, onBeforeArticleAction: async () => { flushed = true; await p.saveDocumentContent(f.entry.id, 'Unsaved editor text'); return true } })
  await click('Append to article…')
  await settle(() => [...document.querySelectorAll('option')].some(option => option.value === f.entry.id))
  await select(f.entry.id)
  await click('Save review proposal')
  await settle(async () => (await p.getEntity(f.message.id)).documentEdits?.length)
  assert.equal(flushed, true)
  assert.equal((await p.getEntity(f.entry.id)).content, 'Unsaved editor text')
  const proposal = (await p.getEntity(f.message.id)).documentEdits[0]
  await tools.applyChatDocumentEdit(f.message.id, proposal.id)
  assert.equal((await p.getEntity(f.entry.id)).content, 'Unsaved editor text\n\nAnswer body')
})
test('replacement leaves the original intact until approval and rejects stale target edits', async t => {
  const f = await fixture()
  await mount(t, ArticleAnswerActions, { ...f, content: 'Answer body', disabled: false, onSaved: async () => {} })
  await click('Replace article…')
  await settle(() => [...document.querySelectorAll('option')].some(option => option.value === f.entry.id))
  await select(f.entry.id)
  assert.match(document.querySelector('[aria-label="Article action preview"]').textContent, /Replacing removes the current article body/)
  await click('Save review proposal')
  await settle(async () => (await p.getEntity(f.message.id)).documentEdits?.length)
  assert.equal((await p.getEntity(f.entry.id)).content, 'Original body')
  const proposal = (await p.getEntity(f.message.id)).documentEdits[0]
  await p.saveDocumentContent(f.entry.id, 'Newer manual edit')
  await assert.rejects(tools.applyChatDocumentEdit(f.message.id, proposal.id), /changed/)
  assert.equal((await p.getEntity(f.entry.id)).content, 'Newer manual edit')
})
test('document approval rolls back the body and snapshot if saving approved status fails', async () => {
  const f = await fixture()
  const result = await tools.executeChatWorkspaceTool(f.world.id, { id: 'replace-answer', type: 'function', function: { name: 'propose_document_replacement', arguments: JSON.stringify({ entity_id: f.entry.id, expected_updated_at: f.entry.updatedAt, new_content: 'Answer body' }) } })
  assert.ok(result.proposal)
  await p.updateEntityAtomically(f.message.id, current => ({ ...current, documentEdits: [result.proposal] }))
  const fail = (modifications, key, object) => {
    if (object.id === f.message.id && modifications.documentEdits?.some(proposal => proposal.status === 'applied')) throw new Error('Approval storage failure')
  }
  db.table('entities').hook('updating', fail)
  try { await assert.rejects(tools.applyChatDocumentEdit(f.message.id, result.proposal.id), /Approval storage failure/) }
  finally { db.table('entities').hook('updating').unsubscribe(fail) }
  assert.equal((await p.getEntity(f.entry.id)).content, 'Original body')
  assert.equal(await db.table('snapshots').where('entityId').equals(f.entry.id).count(), 0)
})
test('creating an article rolls back its identity if saving the answer body fails', async () => {
  const f = await fixture()
  const result = await tools.executeChatWorkspaceTool(f.world.id, { id: 'create-answer', type: 'function', function: { name: 'propose_codex_entry', arguments: JSON.stringify({ title: 'New answer article', category: 'lore-other', content: 'Answer body' }) } })
  assert.ok(result.codexCreation)
  await p.updateEntityAtomically(f.message.id, current => ({ ...current, codexCreations: [result.codexCreation] }))
  const fail = (modifications, key, object) => { if (object.type === 'codexEntry' && object.title === 'New answer article') throw new Error('Simulated storage failure') }
  db.table('entities').hook('updating', fail)
  try { await assert.rejects(tools.createChatCodexEntry(f.message.id, result.codexCreation.id), /Simulated storage failure/) }
  finally { db.table('entities').hook('updating').unsubscribe(fail) }
  assert.equal((await p.listEntitiesByBook(f.world.id, 'codexEntry')).some(entry => entry.title === 'New answer article'), false)
})
test('create answer action saves a preview and only approval creates the World-owned article', async t => {
  const f = await fixture()
  await mount(t, ArticleAnswerActions, { ...f, content: 'Answer body', disabled: false, onSaved: async () => {} })
  await click('Create article…')
  await settle(() => document.querySelectorAll('option').length > 0)
  const input = document.querySelector('input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Created from Chat')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Save review proposal')
  await settle(async () => (await p.getEntity(f.message.id)).codexCreations?.length)
  assert.equal((await p.listEntitiesByBook(f.world.id, 'codexEntry')).length, 2)
  const proposal = (await p.getEntity(f.message.id)).codexCreations[0]
  const result = await tools.createChatCodexEntry(f.message.id, proposal.id)
  const created = await p.getEntity(result.entityId)
  assert.equal(created.worldId, f.world.id)
  assert.equal(created.bookId, f.world.id)
  assert.equal(created.content, 'Answer body')
  assert.equal(created.title, 'Created from Chat')
})
test('a successful proposal save with failed UI refresh is not offered as an unsaved retry', async t => {
  const f = await fixture()
  await mount(t, ArticleAnswerActions, { ...f, content: 'Answer body', disabled: false, onSaved: async () => { throw new Error('Reload failure') } })
  await click('Append to article…')
  await settle(() => [...document.querySelectorAll('option')].some(option => option.value === f.entry.id))
  await select(f.entry.id)
  await click('Save review proposal')
  await settle(() => document.querySelector('[role="alert"]'))
  assert.match(document.querySelector('[role="alert"]').textContent, /proposal was saved/)
  assert.equal(button('Save review proposal'), undefined)
  assert.equal((await p.getEntity(f.message.id)).documentEdits.length, 1)
})
test('failed editor saving preserves the article and offers retry without saving a proposal', async t => {
  const f = await fixture()
  await mount(t, ArticleAnswerActions, { ...f, content: 'Answer body', disabled: false, onSaved: async () => {}, onBeforeArticleAction: async () => false })
  await click('Replace article…')
  await settle(() => [...document.querySelectorAll('option')].some(option => option.value === f.entry.id))
  await select(f.entry.id)
  await click('Save review proposal')
  await settle(() => document.querySelector('[role="alert"]'))
  assert.equal((await p.getEntity(f.entry.id)).content, 'Original body')
  assert.equal((await p.getEntity(f.message.id)).documentEdits?.length ?? 0, 0)
  assert.ok(button('Save review proposal'))
})
