import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import 'fake-indexeddb/auto'
import { transpileSourceTree } from './transpile-source-tree.mjs'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://arc.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'localStorage', 'sessionStorage', 'Event', 'CustomEvent']) globalThis[key] = dom.window[key]
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const h = React.createElement
const directory = mkdtempSync(new URL('../node_modules/.arc-chat-media-profiles-test-', import.meta.url))
transpileSourceTree(directory)
// Template editing is outside these tests; avoid CodeMirror's browser layout dependencies.
writeFileSync(`${directory}/features/settings/PromptTemplateEditor.mjs`, `
import React from 'react';
export default function PromptTemplateEditor({ value, ariaLabel, onChange }) {
  return React.createElement('textarea', { value, 'aria-label': ariaLabel, onChange: event => onChange(event.target.value) });
}
`)
writeFileSync(`${directory}/features/chat/chat-api.mjs`, `
export const calls = [];
let handler = async () => ({ toolCalls: [] });
export function reset(next) { calls.length = 0; handler = next ?? (async () => ({ toolCalls: [] })); }
export async function streamChatCompletion(request, onChunk, signal) {
  signal.throwIfAborted(); calls.push(structuredClone(request));
  return handler(request, onChunk, signal, calls.length);
}
`)
renameSync(`${directory}/features/images/book-image-settings.mjs`, `${directory}/features/images/book-image-settings-original.mjs`)
writeFileSync(`${directory}/features/images/book-image-settings.mjs`, `
export * from './book-image-settings-original.mjs';
import { loadBookImageSettings as realLoad } from './book-image-settings-original.mjs';
export const calls = [];
const waits = [];
export function holdNext(bookId) {
  let release, started;
  const promise = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  waits.push({ bookId, promise, started });
  return { release, ready };
}
export async function loadBookImageSettings(bookId) {
  const settings = await realLoad(bookId);
  calls.push(bookId);
  const index = waits.findIndex(wait => wait.bookId === bookId);
  if (index >= 0) { const [wait] = waits.splice(index, 1); wait.started(); await wait.promise; }
  return settings;
}
`)
const moduleAt = name => import(pathToFileURL(`${directory}/${name}.mjs`))
const p = await moduleAt('data/persistence')
const ai = await moduleAt('shared/ai/ai-settings')
const profiles = await moduleAt('features/settings/settings-profiles')
const imageSettings = await moduleAt('features/images/image-settings')
const media = await moduleAt('features/images/book-image-settings')
const service = await moduleAt('features/chat/chat-service')
const character = await moduleAt('features/chat/character-chat')
const api = await moduleAt('features/chat/chat-api')
const request = await moduleAt('features/chat/chat-request')
const { ChatView } = await moduleAt('features/chat/ChatFeature')
const context = { summaryContext: '', currentSceneText: '', previousSceneText: '', automaticCodex: [], automaticSources: [], additionalSources: [] }
const bookValues = { title: 'Scoped book', overview: '', genre: '', style: '', pov: '', tense: '', language: '', series: '', seriesOrder: '' }
const keys = { nanogpt: '', openai: 'private-local-media-key', pruna: '' }
function favorite(id, alias) { return { ...imageSettings.imageFavorite(imageSettings.documentedImageModels.find(model => model.id === id), []), alias } }
function mediaValues(favorites) {
  return { favorites, defaultAlias: favorites[0]?.alias ?? '', defaultAliases: Object.fromEntries(favorites.flatMap(model => model.tasks.map(task => [task, model.alias]))) }
}
async function fixture(alias = 'Book image') {
  const { book } = await p.createBook(ai.loadAiSettings(), 'Scoped media book')
  const image = profiles.createSettingsProfile('image', alias + ' profile')
  const video = profiles.createSettingsProfile('video', alias + ' video profile')
  image.media = mediaValues([favorite('gpt-image-1.5', alias)])
  video.media = mediaValues([favorite('p-video', alias + ' video')])
  profiles.saveSettingsProfile(image)
  profiles.saveSettingsProfile(video)
  const selections = await p.getBookProfileSelections(book.id)
  await p.saveBookProfileSelections(book.id, { ...selections, image: image.id, video: video.id })
  const chat = await service.createChat(book.id)
  return { book, chat, image, video }
}
function view(fixture, toasts = []) {
  return h(ChatView, { bookId: fixture.book.id, chatId: fixture.chat.id, bookPromptValues: bookValues, onChatChange() {}, onToast(message) { toasts.push(message) } })
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.getAttribute('aria-label') === text)
async function click(text) { const element = button(text); assert.ok(element, `Missing ${text}: ${document.body.textContent}`); await act(async () => element.click()) }
async function settle(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.ok(predicate(), document.body.textContent)
}
async function send(text = 'Help plan an illustration') {
  await settle(() => Boolean(document.querySelector('textarea[aria-label="Chat message"]')))
  const input = document.querySelector('textarea[aria-label="Chat message"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click('Send')
}
function tool(name, args, id = 'call') { return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } } }
const previewText = () => document.querySelector('.chat-request-preview')?.textContent ?? ''

beforeEach(() => {
  localStorage.clear()
  ai.saveAiSettings({ ...ai.copyAiSettings(ai.initialAiSettings), provider: 'fake', mainModel: 'fake/test', chatModel: 'fake/test', mainModelContextLength: 100000, chatModelContextLength: 100000 })
  imageSettings.saveImageSettings({ ...mediaValues([favorite('gpt-image-1', 'Global image'), favorite('p-video', 'Global video')]), keys })
  profiles.loadSettingsProfiles()
  api.reset()
  media.calls.length = 0
})
after(async () => { (await p.database()).close(); dom.window.close(); rmSync(directory, { recursive: true, force: true }) })

test('request APIs accept a selected-book snapshot without credentials and retain optional legacy compatibility', async () => {
  const f = await fixture()
  const snapshot = await media.loadBookImageSettings(f.book.id)
  const values = request.chatRequestValues(bookValues, context, undefined, snapshot)
  assert.match(values['chat.workspace_instructions'], /Book image/)
  assert.match(values['chat.workspace_instructions'], /Book image video/)
  assert.doesNotMatch(values['chat.workspace_instructions'], /Global image|Global video|private-local-media-key/)
  assert.match(request.chatRequestValues(bookValues, context)['chat.workspace_instructions'], /Global image/)
  const assembled = request.assembleChatGenerationRequest({ composition: request.defaultChatPromptComposition, book: bookValues, context, history: [], mediaSettings: snapshot })
  assert.match(JSON.stringify(assembled.providerMessages), /Book image/)
  assert.doesNotMatch(JSON.stringify(assembled.providerMessages), /Global image|private-local-media-key/)
  assert.doesNotThrow(() => request.assembleChatGenerationRequest({ composition: request.defaultChatPromptComposition, book: bookValues, context, history: [] }))
})

test('character assembly preserves the exact restricted boundary and adds only the captured media inventory', async () => {
  const f = await fixture()
  const snapshot = await media.loadBookImageSettings(f.book.id)
  const boundary = 'Only Mara knows the harbor. No future knowledge or workspace editing.'
  assert.equal(request.chatRequestValues(bookValues, context, boundary, snapshot)['chat.workspace_instructions'], boundary)
  const assembled = request.assembleChatGenerationRequest({ composition: { systemPrompt: '{{book.title}}', predefinedMessages: [] }, book: { ...bookValues, title: 'FUTURE_BOOK_SECRET' }, context, history: [], restrictedInstructions: boundary, mediaSettings: snapshot })
  assert.equal(assembled.parts.find(part => part.id === 'character-boundary').content, boundary)
  assert.match(assembled.parts.find(part => part.id === 'character-media-models').content, /Book image/)
  assert.doesNotMatch(JSON.stringify(assembled.providerMessages), /FUTURE_BOOK_SECRET|private-local-media-key|# Workspace tools/)
  const legacy = request.assembleChatGenerationRequest({ composition: { systemPrompt: 'Stay in character', predefinedMessages: [] }, book: bookValues, context, history: [], restrictedInstructions: boundary })
  assert.equal(legacy.parts.some(part => part.id === 'character-media-models'), false)
})

test('one assistant operation captures media once and uses that snapshot for all tool rounds and proposals', async () => {
  const f = await fixture()
  const toasts = []
  api.reset(async (_request, _onChunk, _signal, round) => {
    assert.equal(media.calls.filter(id => id === f.book.id).length, 1, 'No media reload between tool rounds')
    if (round < 3) {
      f.image.media = mediaValues([favorite('gpt-image-2', `Changed image ${round}`)])
      profiles.saveSettingsProfile(f.image)
      return { toolCalls: [tool('search_entities', { query: 'harbor' }, `read-${round}`)] }
    }
    return { toolCalls: [tool('propose_image_generation', { prompt: 'A harbor', model_alias: 'Book image' }, 'proposal')] }
  })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f, toasts)))
    await send()
    await settle(() => api.calls.length === 3 && button('Send') && !button('Send').disabled)
    let history
    await act(async () => { history = await service.listChatMessages(f.book.id, f.chat.id); await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(history.flatMap(message => message.imageGenerations ?? [])[0].modelAlias, 'Book image')
    for (const call of api.calls) {
      assert.match(JSON.stringify(call.messages), /Book image/)
      assert.doesNotMatch(JSON.stringify(call.messages), /Changed image|Global image|private-local-media-key/)
    }
    assert.deepEqual(api.calls[1].messages.slice(0, api.calls[0].messages.length), api.calls[0].messages)
    assert.equal(toasts.length, 0)
    assert.equal((await (await p.database()).table('imageJobs').where('bookId').equals(f.book.id).toArray()).length, 0)
  } finally { await act(async () => root.unmount()) }
})

test('character runtime shares captured media instructions and proposals without widening its knowledge boundary', async () => {
  const f = await fixture()
  const chapter = await p.createStructuralEntity('chapter', f.book.id, f.book.id, 'Chapter')
  const scene = await p.createStructuralEntity('scene', f.book.id, chapter.id, 'FUTURE_BOOK_SECRET')
  await p.saveDocumentContent(scene.id, 'Known prose. FUTURE_BOOK_SECRET')
  const entry = await p.createCodexEntry(f.book.id, 'Mara')
  await (await p.database()).table('entities').update(entry.id, { typeId: 'lore-character', content: 'Mara is kind.' })
  f.chat = await character.createCharacterChat(f.book.id, [{ entryId: entry.id, label: 'Mara' }], { bookId: f.book.id, sceneId: scene.id, position: 12 })
  const toasts = []
  api.reset(async (request, _onChunk, _signal, round) => {
    assert.equal(media.calls.filter(id => id === f.book.id).length, 1)
    assert.match(JSON.stringify(request.messages), /Book image/)
    assert.doesNotMatch(JSON.stringify(request.messages), /FUTURE_BOOK_SECRET|Global image|private-local-media-key|# Workspace tools/)
    if (round === 1) {
      f.image.media = mediaValues([favorite('gpt-image-2', 'Changed character image')])
      profiles.saveSettingsProfile(f.image)
      return { toolCalls: [tool('read_story_context', {}, 'read')] }
    }
    return { toolCalls: [tool('propose_image_generation', { prompt: 'Mara at the harbor', model_alias: 'Book image' }, 'proposal')] }
  })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f, toasts)))
    await send()
    await settle(() => api.calls.length === 2 && button('Send') && !button('Send').disabled)
    let history
    await act(async () => { history = await service.listChatMessages(f.book.id, f.chat.id); await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(history.flatMap(message => message.imageGenerations ?? [])[0].modelAlias, 'Book image')
    assert.ok(history.filter(message => message.role === 'assistant').every(message => message.characterBoundary))
    assert.doesNotMatch(JSON.stringify(api.calls), /Changed character image/)
    assert.equal(toasts.length, 0)
  } finally { await act(async () => root.unmount()) }
})

test('continuations capture current media once while preserving the original provider prefix', async () => {
  const f = await fixture()
  f.chat = await service.updateChat(f.chat.id, { maxModelRounds: 1 })
  const toasts = []
  api.reset(async (_request, _onChunk, _signal, round) => {
    assert.equal(media.calls.filter(id => id === f.book.id).length, round, 'One capture per assistant operation')
    return { toolCalls: [round === 1
      ? tool('search_entities', { query: 'harbor' }, 'read')
      : tool('propose_image_generation', { prompt: 'A harbor', model_alias: 'Continuation image' }, 'proposal')] }
  })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f, toasts)))
    await send()
    await settle(() => button('Continue') && !button('Continue').disabled)
    await act(async () => {
      f.image.media = mediaValues([favorite('gpt-image-2', 'Continuation image')])
      profiles.saveSettingsProfile(f.image)
    })
    await click('Continue')
    await settle(() => api.calls.length === 2 && button('Send') && !button('Send').disabled)
    assert.deepEqual(api.calls[1].messages.slice(0, api.calls[0].messages.length), api.calls[0].messages)
    const inventory = api.calls[1].messages.find(message => message.role === 'system' && message.content.includes('supersedes earlier media inventories'))
    assert.match(inventory.content, /Continuation image/)
    assert.doesNotMatch(inventory.content, /Book image"|Global image|private-local-media-key/)
    let history
    await act(async () => { history = await service.listChatMessages(f.book.id, f.chat.id); await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.equal(history.flatMap(message => message.imageGenerations ?? [])[0].modelAlias, 'Continuation image')
    assert.doesNotMatch(JSON.stringify(history), /private-local-media-key/)
    assert.equal(toasts.length, 0)
  } finally { await act(async () => root.unmount()) }
})

test('prompt previews resolve book profiles, refresh profile edits and selection changes, and never show global inventory', async () => {
  const f = await fixture()
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(view(f)))
    await settle(() => Boolean(button('Request composition')))
    await click('Request composition')
    await settle(() => previewText().includes('Book image'))
    assert.doesNotMatch(previewText(), /Global image|private-local-media-key/)
    await act(async () => {
      f.image.media = mediaValues([favorite('gpt-image-2', 'Updated book image')])
      profiles.saveSettingsProfile(f.image)
    })
    await settle(() => previewText().includes('Updated book image'))
    await act(async () => {
      const replacement = profiles.createSettingsProfile('image', 'Replacement profile')
      replacement.media = mediaValues([favorite('gpt-image-1', 'Replacement book image')])
      profiles.saveSettingsProfile(replacement)
      await p.saveBookProfileSelections(f.book.id, { ...await p.getBookProfileSelections(f.book.id), image: replacement.id })
    })
    await settle(() => previewText().includes('Replacement book image'))
    assert.doesNotMatch(previewText(), /Updated book image|Global image|private-local-media-key/)
  } finally { await act(async () => root.unmount()) }
})

test('delayed preview results cannot overwrite a newer same-book profile refresh', async () => {
  const f = await fixture()
  const root = createRoot(document.getElementById('root'))
  const held = media.holdNext(f.book.id)
  try {
    await act(async () => root.render(view(f)))
    await settle(() => Boolean(button('Request composition')))
    await click('Request composition')
    await act(async () => held.ready)
    await act(async () => {
      f.image.media = mediaValues([favorite('gpt-image-2', 'Newer inventory')])
      profiles.saveSettingsProfile(f.image)
    })
    await settle(() => previewText().includes('Newer inventory'))
    await act(async () => held.release())
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
    assert.match(previewText(), /Newer inventory/)
    assert.doesNotMatch(previewText(), /Book image\"|Global image/)
  } finally { held.release(); await act(async () => root.unmount()) }
})

test('late media preview results cannot update a different selected book or chat', async () => {
  const first = await fixture('First inventory'), second = await fixture('Second inventory')
  const root = createRoot(document.getElementById('root'))
  const held = media.holdNext(first.book.id)
  try {
    await act(async () => root.render(view(first)))
    await settle(() => Boolean(button('Request composition')))
    await click('Request composition')
    await act(async () => held.ready)
    await act(async () => root.render(view(second)))
    await settle(() => Boolean(button('Request composition')) && !document.querySelector('.chat-prompt-dialog'))
    await click('Request composition')
    await settle(() => previewText().includes('Second inventory'))
    await act(async () => held.release())
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
    assert.match(previewText(), /Second inventory/)
    assert.doesNotMatch(previewText(), /First inventory|Global image/)
  } finally { held.release(); await act(async () => root.unmount()) }
})

test('a selection change during media preflight cannot persist a turn or start a provider request', async () => {
  const first = await fixture('First inventory'), second = await fixture('Second inventory')
  const root = createRoot(document.getElementById('root'))
  const held = media.holdNext(first.book.id)
  try {
    await act(async () => root.render(view(first)))
    await send()
    await act(async () => held.ready)
    await act(async () => root.render(view(second)))
    await settle(() => Boolean(button('Request composition')))
    await act(async () => held.release())
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    assert.equal(api.calls.length, 0)
    assert.equal((await service.listChatMessages(first.book.id, first.chat.id)).length, 0)
    assert.equal((await service.listChatMessages(second.book.id, second.chat.id)).length, 0)
  } finally { held.release(); await act(async () => root.unmount()) }
})

test('corrupt media libraries show preview errors and block preflight without falling back to legacy favorites', async () => {
  const f = await fixture()
  const root = createRoot(document.getElementById('root'))
  const toasts = []
  try {
    await act(async () => root.render(view(f, toasts)))
    await settle(() => Boolean(button('Request composition')))
    await click('Request composition')
    await settle(() => previewText().includes('Book image'))
    await act(async () => {
      localStorage.setItem(profiles.SETTINGS_PROFILES_STORAGE_KEY, '{broken')
      window.dispatchEvent(new Event(profiles.SETTINGS_PROFILES_EVENT))
    })
    await settle(() => previewText().includes('could not be loaded'))
    assert.doesNotMatch(previewText(), /Global image|Book image/)
    await click('Close request composition')
    await send()
    await settle(() => toasts.some(message => message.includes('could not be loaded')) && button('Send') && !button('Send').disabled)
    assert.equal(api.calls.length, 0)
    assert.equal((await service.listChatMessages(f.book.id, f.chat.id)).length, 0)
  } finally { await act(async () => root.unmount()) }
})
