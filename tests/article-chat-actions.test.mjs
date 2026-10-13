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
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
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
const { ChatView, MarkdownMessage } = await at('features/chat/ChatFeature')
const { initialAiSettings } = await at('shared/ai/ai-settings')
const { assembleChatGenerationRequest } = await at('features/chat/chat-request')
const { buildContextValues } = await at('shared/context/context-service')
const originalConsoleError = console.error
const actWarnings = []
console.error = (...args) => {
  if (String(args[0]).includes('not wrapped in act')) actWarnings.push(args.map(String).join(' '))
  originalConsoleError(...args)
}
after(() => {
  console.error = originalConsoleError
  db.close(); dom.window.close(); rmSync(directory, { recursive: true, force: true })
  assert.deepEqual(actWarnings, [], 'All component updates must be exercised within act')
})
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) if (table.name !== 'meta') await table.clear() })
  localStorage.clear(); sessionStorage.clear()
})
async function drainEffects() {
  await act(async () => {
    // Article/type loads use IndexedDB transactions. Queue a barrier behind
    // their existing reads, then let React flush their completion callbacks.
    await new Promise(resolve => setImmediate(resolve))
    await db.transaction('rw', db.table('entities'), () => db.table('entities').count())
  })
}
async function mount(t, component, props) {
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()) })
  const render = async next => { await act(async () => root.render(React.createElement(component, next))); await drainEffects() }
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
async function click(text) {
  assert.ok(button(text), text); assert.equal(button(text).disabled, false)
  await act(async () => button(text).click())
  await drainEffects()
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
for (const scope of ['Book', 'World']) {
  test(`${scope} Chat has no inline article picker and preserves context configured in settings`, async t => {
    const owner = scope === 'World' ? await worlds.createWorld('Chat owner') : (await p.createBook(initialAiSettings, 'Chat owner')).book
    const chat = await chatService.createChat(owner.id)
    const entry = await p.createCodexEntry(owner.id, 'Selected article', 'lore-other')
    await p.saveDocumentContent(entry.id, 'Selected article body')
    await chatService.saveChatContextProfile(chat.id, { ...chat.contextProfile, codexEntryIds: [entry.id] })
    const props = { bookId: owner.id, chatId: chat.id, bookPromptValues: { title: owner.title }, onChatChange() {}, onToast() {} }
    const render = await mount(t, ChatView, props)
    const assertChatReady = async () => {
      await settle(() => document.querySelector('.functional-chat h1')?.textContent === chat.title)
      assert.equal(document.querySelector('.functional-chat header small')?.textContent, `${scope} chat`)
      assert.ok(!document.querySelector('[aria-label="Explicit article context"]'))
      assert.ok(!document.querySelector('.chat-article-context'))
      assert.ok(!button('Add current article to context'))
      assert.equal([...document.querySelectorAll('summary')].some(item => item.textContent === 'Choose articles'), false)
      assert.deepEqual((await chatService.getChat(chat.id)).contextProfile.codexEntryIds, [entry.id])
    }
    await assertChatReady()
    await render({ ...props, key: 'restored-chat' })
    await assertChatReady()
    const savedChat = await chatService.getChat(chat.id)
    const context = await buildContextValues({ bookId: owner.id, type: 'chat', profile: savedChat.contextProfile })
    assert.match(context.additionalContext, /Selected article body/)
  })
}
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
