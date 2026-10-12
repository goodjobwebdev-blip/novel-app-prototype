import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act, createElement: h } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.chat-answer-controls-', import.meta.url))
transpileSourceTree(directory)
const at = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await at('data/persistence')
const ai = await at('shared/ai/ai-settings')
const { createWorld } = await at('features/worlds/world-service')
const { createChat, createChatMessage } = await at('features/chat/chat-service')
const { executeChatWorkspaceTool } = await at('features/chat/chat-tools')
const { ChatView } = await at('features/chat/ChatFeature')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function settle(predicate) {
  for (let i = 0; i < 300 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}

for (const scope of ['book', 'world']) {
  test(`${scope} chat has no manual article actions and retains proposal approvals and answer controls`, async t => {
    const settings = ai.copyAiSettings(ai.initialAiSettings)
    settings.provider = 'fake'; settings.mainModel = 'fake/test'
    const owner = scope === 'world' ? await createWorld('Control test world') : (await p.createBook(settings, 'Control test book')).book
    const entry = await p.createCodexEntry(owner.id, 'Existing article', 'lore-other')
    await p.saveDocumentContent(entry.id, 'Original article')
    const current = await p.getEntity(entry.id)
    const chat = await createChat(owner.id)
    const create = await executeChatWorkspaceTool(owner.id, { id: 'create', type: 'function', function: { name: 'propose_codex_entry', arguments: JSON.stringify({ title: 'Proposed article', category: 'lore-other', content: 'New article body' }) } })
    const replace = await executeChatWorkspaceTool(owner.id, { id: 'replace', type: 'function', function: { name: 'propose_document_replacement', arguments: JSON.stringify({ entity_id: entry.id, expected_updated_at: current.updatedAt, new_content: 'Revised article' }) } })
    assert.ok(create.codexCreation, create.content)
    assert.ok(replace.proposal, replace.content)
    const message = await createChatMessage(chat, 'assistant', 'Discussion about the writing style.', { codexCreations: [create.codexCreation], documentEdits: [replace.proposal] })
    const root = createRoot(document.getElementById('root'))
    t.after(async () => { await act(async () => root.unmount()) })
    let flushes = 0
    await act(async () => root.render(h(ChatView, { bookId: owner.id, chatId: chat.id, bookPromptValues: { title: owner.title }, onChatChange() {}, onToast() {}, onBeforeArticleAction: async () => { flushes++; return true } })))
    await settle(() => Boolean(document.querySelector('[aria-label="Copy answer"]')) && Boolean(button('Create')) && Boolean(button('Apply')))
    for (const label of ['Create article…', 'Append to article…', 'Replace article…']) assert.equal(Boolean(button(label)), false, `${label} must not be shown`)
    assert.equal(document.querySelector('[aria-label="Chat answer article actions"]'), null)
    for (const label of ['Copy answer', 'Edit answer', 'Fork from answer', 'Read answer aloud', 'Regenerate answer', 'Delete answer and following messages']) assert.ok(document.querySelector(`button[aria-label="${label}"]`), label)
    assert.equal((await p.getEntity(entry.id)).content, 'Original article', 'Proposals do not mutate the article before approval')
    await act(async () => button('Apply').click())
    await settle(() => !button('Apply'))
    await act(async () => { assert.equal((await p.getEntity(entry.id)).content, 'Revised article') })
    await act(async () => button('Create').click())
    await settle(() => !button('Create'))
    await act(async () => {
      const stored = await p.getEntity(message.id)
      assert.equal(stored.documentEdits[0].status, 'applied')
      assert.equal(stored.codexCreations[0].status, 'created')
      const created = await p.getEntity(stored.codexCreations[0].entityId)
      assert.equal(created.content, 'New article body')
      assert.equal(created.bookId, owner.id)
      if (scope === 'world') assert.equal(created.worldId, owner.id)
    })
    assert.equal(flushes, 2, 'Proposal approval still saves the current editor first')
  })
}
