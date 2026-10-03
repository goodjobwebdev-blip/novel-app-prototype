import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'sessionStorage', 'localStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback } observe() { this.callback() } disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act, createElement: h, useState } = React
const { createRoot } = await import('react-dom/client')
const directory = mkdtempSync(new URL('../node_modules/.arc-proposal-toast-test-', import.meta.url))
transpileSourceTree(directory)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
const ai = await moduleAt('shared/ai/ai-settings')
const { createChat, createChatMessage } = await moduleAt('features/chat/chat-service')
const { executeChatWorkspaceTool } = await moduleAt('features/chat/chat-tools')
const { executeChatEntityTool } = await moduleAt('features/chat/chat-entity-tools')
const { executeChatOutlineTool } = await moduleAt('features/chat/chat-outline-tools')
const { ChatView } = await moduleAt('features/chat/ChatFeature')
const { default: Toast } = await moduleAt('shared/ui/Toast')
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

function ChatWithToast({ fixture, notifications }) {
  const [toast, setToast] = useState(null)
  // Match Workspace's error default, so success must be explicitly requested by ChatView.
  function onToast(message, variant = 'error') {
    notifications.push({ message, variant })
    setToast({ message, variant })
  }
  return h(React.Fragment, null,
    h(ChatView, { bookId: fixture.book.id, chatId: fixture.chat.id, bookPromptValues: { title: fixture.book.title }, onChatChange() {}, onToast }),
    toast && h(Toast, { fixed: true, variant: toast.variant, title: toast.variant === 'error' ? 'Something went wrong' : 'Done', onDismiss: () => setToast(null) }, toast.message),
  )
}

const cases = [
  { name: 'document edit', execute: executeChatWorkspaceTool, tool: 'propose_document_edit', field: 'documentEdits', result: 'proposal', button: 'Apply', message: 'Applied changes to “Draft”.', args: f => ({ entity_id: f.note.id, expected_updated_at: f.note.updatedAt, edits: [{ old_text: 'Original', new_text: 'Revised' }] }) },
  { name: 'document replacement', execute: executeChatWorkspaceTool, tool: 'propose_document_replacement', field: 'documentEdits', result: 'proposal', button: 'Apply', message: 'Applied changes to “Draft”.', args: f => ({ entity_id: f.note.id, expected_updated_at: f.note.updatedAt, new_content: 'Revised passage.' }) },
  { name: 'Codex creation', execute: executeChatWorkspaceTool, tool: 'propose_codex_entry', field: 'codexCreations', result: 'codexCreation', button: 'Create', message: 'Created Codex entry “The harbor”.', args: () => ({ title: 'The harbor', content: 'A sheltered port.' }) },
  { name: 'entity action', execute: executeChatEntityTool, tool: 'propose_entity_rename', field: 'entityActions', result: 'entityAction', button: 'Rename', message: 'Renamed “Draft”.', args: f => ({ entity_id: f.note.id, new_title: 'Revised title' }) },
  { name: 'outline action', execute: executeChatOutlineTool, tool: 'propose_outline_rename', field: 'outlineActions', result: 'outlineAction', button: 'Rename', args: f => ({ entity_id: f.scene.id, new_title: 'Revised opening' }) },
]

async function fixtureFor(item) {
  const settings = ai.copyAiSettings(ai.initialAiSettings)
  settings.provider = 'fake'
  settings.mainModel = 'fake/test'
  const created = await p.createBook(settings, 'Toast test')
  const note = await p.createNote(created.book.id, 'Draft')
  await p.saveDocumentContent(note.id, 'Original passage.')
  const fixture = { ...created, note: await p.getEntity(note.id), chat: await createChat(created.book.id) }
  const result = await item.execute(fixture.book.id, { id: crypto.randomUUID(), type: 'function', function: { name: item.tool, arguments: JSON.stringify(item.args(fixture)) } })
  assert.equal(JSON.parse(result.content).ok, true, result.content)
  fixture.message = await createChatMessage(fixture.chat, 'assistant', 'Suggested change.', { [item.field]: [result[item.result]] })
  return fixture
}

const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text)
async function settle(predicate) {
  for (let i = 0; i < 300 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function mount(fixture, notifications) {
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(h(ChatWithToast, { fixture, notifications })))
  await settle(() => Boolean(button('Reject')))
  return root
}

for (const item of cases) {
  test(`approving ${item.name} proposals renders a dismissible success toast`, async () => {
    const fixture = await fixtureFor(item)
    const notifications = []
    const root = await mount(fixture, notifications)
    try {
      await act(async () => button(item.button).click())
      await settle(() => notifications.length > 0)
      assert.deepEqual(notifications, [{ message: item.message ?? `Approved rename for “${fixture.scene.title}”.`, variant: 'success' }])
      const toast = document.querySelector('.arc-toast')
      assert.ok(toast.classList.contains('arc-toast--success'))
      assert.ok(toast.classList.contains('arc-toast--fixed'))
      assert.equal(toast.getAttribute('role'), 'status')
      assert.ok(toast.querySelector('.lucide-circle-check'))
      assert.equal(toast.querySelector('strong').textContent, 'Done')
      await act(async () => {
        assert.equal((await p.getEntity(fixture.message.id))[item.field][0].status, item.field === 'codexCreations' ? 'created' : 'applied')
        if (item.field === 'documentEdits') assert.equal((await p.getEntity(fixture.note.id)).content, 'Revised passage.')
      })
      assert.equal(button(item.button), undefined, 'An accepted proposal cannot be applied again')
      await act(async () => toast.querySelector('button[aria-label="Dismiss Done"]').click())
      assert.equal(document.querySelector('.arc-toast'), null)
      await act(async () => root.render(h(ChatWithToast, { fixture, notifications })))
      assert.equal(document.querySelector('.arc-toast'), null, 'Rerender does not restore dismissed feedback')
      assert.equal(notifications.length, 1)
    } finally { await act(async () => root.unmount()) }
  })
}

test('a stale document approval still renders an error toast and preserves the new content', async () => {
  const fixture = await fixtureFor(cases[0])
  await p.saveDocumentContent(fixture.note.id, 'Author changed the passage.')
  const notifications = []
  const root = await mount(fixture, notifications)
  try {
    await act(async () => button('Apply').click())
    await settle(() => notifications.length > 0)
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].variant, 'error')
    assert.match(notifications[0].message, /document changed after the proposal/)
    const toast = document.querySelector('.arc-toast')
    assert.ok(toast.classList.contains('arc-toast--error'))
    assert.equal(toast.getAttribute('role'), 'alert')
    assert.equal(toast.querySelector('strong').textContent, 'Something went wrong')
    await act(async () => {
      assert.equal((await p.getEntity(fixture.note.id)).content, 'Author changed the passage.')
      assert.equal((await p.getEntity(fixture.message.id)).documentEdits[0].status, 'stale')
    })
  } finally { await act(async () => root.unmount()) }
})

test('rejecting a proposed edit does not emit success feedback or change the document', async () => {
  const fixture = await fixtureFor(cases[0])
  const notifications = []
  const root = await mount(fixture, notifications)
  try {
    await act(async () => button('Reject').click())
    await settle(() => !button('Reject'))
    assert.deepEqual(notifications, [])
    assert.equal(document.querySelector('.arc-toast'), null)
    await act(async () => {
      assert.equal((await p.getEntity(fixture.note.id)).content, 'Original passage.')
      assert.equal((await p.getEntity(fixture.message.id)).documentEdits[0].status, 'rejected')
    })
  } finally { await act(async () => root.unmount()) }
})
