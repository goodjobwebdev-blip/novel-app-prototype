import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'

const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const ai = await import('../src/ai-settings.ts')
const p = await import('../src/persistence.ts')
const chats = await import('../src/chat-service.ts')
const { streamChatCompletion } = await import('../src/chat-api.ts')
const { streamTextProviderCompletion } = await import('../src/text-provider.ts')
const { getFakeProviderTrace } = await import('../src/fake-provider.ts')
const { normalizeThinkingEffort } = await import('../src/thinking-effort.ts')
const { switchProviderProfile } = await import('../src/provider-profiles.ts')
after(async () => (await p.database()).close())

test('effort defaults normalize, survive persistence and remain isolated across books and chats', async () => {
  for (const value of [undefined, null, '', 'invalid', 3, {}, 'HIGH']) assert.equal(normalizeThinkingEffort(value), 'default')
  const configured = ai.normalizeAiSettings({ ...ai.initialAiSettings, mainModel: 'writer', mainThinkingEffort: 'low', supportThinkingEffort: 'minimal', codexThinkingEffort: 'xhigh', chatThinkingEffort: 'high' })
  ai.saveAiSettings(configured)
  const defaults = ai.loadAiSettings()
  for (const role of ['main', 'support', 'codex', 'chat']) assert.equal(defaults[`${role}ThinkingEffort`], configured[`${role}ThinkingEffort`])
  const { book } = await p.createBook(defaults, 'Effort defaults')
  let chat = await chats.createChat(book.id)
  assert.equal(chat.model, 'writer')
  assert.equal(chat.thinking, true)
  assert.equal(chat.thinkingEffort, 'high')
  ai.saveAiSettings({ ...defaults, chatThinkingEffort: 'low' })
  assert.equal((await chats.createChat(book.id)).thinkingEffort, 'high')
  await p.saveBookAiSettings(book.id, { ...defaults, chatThinkingEffort: 'medium' })
  assert.equal((await chats.createChat(book.id)).thinkingEffort, 'medium')
  assert.equal((await chats.getChat(chat.id)).thinkingEffort, 'high')
  chat = await chats.updateChat(chat.id, { thinkingEffort: 'low' })
  const fork = await chats.forkChat(chat, -1)
  assert.equal((await chats.getChat(fork.id)).thinkingEffort, 'low')
  await chats.updateChat(chat.id, { thinkingEffort: 'xhigh' })
  assert.equal((await chats.getChat(fork.id)).thinkingEffort, 'low')
  assert.equal((await p.getBookAiSettings(book.id, [])).chatThinkingEffort, 'medium')
})

test('legacy and malformed chat effort keeps the saved toggle and migrates without changing history', async () => {
  const { book } = await p.createBook(ai.initialAiSettings, 'Legacy effort')
  const chat = await chats.createChat(book.id)
  assert.equal(chat.thinking, false)
  const message = await chats.createChatMessage(chat, 'user', 'Keep this message')
  for (const thinking of [false, true]) {
    for (const thinkingEffort of [undefined, 'unsupported']) {
      await p.putEntity({ ...chat, thinking, thinkingEffort })
      const migrated = await chats.getChat(chat.id)
      assert.equal(migrated.thinkingEffort, 'default')
      assert.equal(migrated.thinking, thinking)
      assert.equal((await chats.listChatMessages(book.id, chat.id))[0].id, message.id)
    }
  }
})

test('provider switching resets effort and restores each saved profile', () => {
  const original = ai.normalizeAiSettings({ ...ai.initialAiSettings, chatThinkingEffort: 'high', mainThinkingEffort: 'low' })
  const openai = switchProviderProfile(original, 'openai')
  assert.equal(openai.chatThinkingEffort, 'default')
  const restored = switchProviderProfile(JSON.parse(JSON.stringify({ ...openai, chatThinkingEffort: 'medium' })), 'nanogpt')
  assert.equal(restored.chatThinkingEffort, 'high')
  assert.equal(restored.mainThinkingEffort, 'low')
  assert.equal(switchProviderProfile(restored, 'openai').chatThinkingEffort, 'medium')
})

function streamResponse() {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"Thought","content":"Answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('real chat transport maps each effort to the provider API while preserving messages, tools and streaming', async () => {
  const originalFetch = globalThis.fetch
  const messages = [{ role: 'user', content: 'Help' }]
  const tools = [{ type: 'function', function: { name: 'read', description: 'Read', parameters: { type: 'object' } } }]
  let body
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return streamResponse() }
  try {
    for (const provider of ['nanogpt', 'openrouter', 'openai', 'compatible']) {
      for (const thinkingEffort of ['default', 'minimal', 'low', 'medium', 'high', 'xhigh']) {
        const request = { provider, apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', model: 'reasoning-model', messages, tools, thinking: true, thinkingEffort }
        const chunks = []
        await streamChatCompletion(request, chunk => chunks.push(chunk), new AbortController().signal)
        assert.deepEqual(body.messages, messages)
        assert.deepEqual(body.tools, tools)
        assert.equal(body.tool_choice, 'auto')
        assert.equal(body.stream, true)
        assert.deepEqual(chunks, [{ content: 'Answer', thoughts: 'Thought' }])
        if (provider === 'nanogpt' || provider === 'openrouter') {
          assert.equal(body.reasoning.effort, thinkingEffort === 'default' ? undefined : thinkingEffort)
          assert.equal(body.reasoning.enabled, true)
          assert.equal(body.reasoning_effort, undefined)
        } else {
          assert.equal(body.reasoning_effort, thinkingEffort === 'default' ? undefined : thinkingEffort)
          if (thinkingEffort !== 'default' || provider === 'openai') assert.equal(body.reasoning, undefined)
        }
        if (provider === 'nanogpt') assert.equal(body.reasoning.delta_field, 'reasoning_content')
        await streamChatCompletion({ ...request, thinking: false }, () => {}, new AbortController().signal)
        assert.equal(body.reasoning, undefined)
        assert.equal(body.reasoning_effort, undefined)
        assert.equal(body.include_reasoning, undefined)
      }
    }
  } finally { globalThis.fetch = originalFetch }
})

test('NanoGPT text transport sends effort and keeps its legacy default; Fake traces it without network calls', async () => {
  const originalFetch = globalThis.fetch
  let body
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return streamResponse() }
  const request = { provider: 'nanogpt', apiKey: 'test-only', baseUrl: 'https://provider.invalid/v1', task: 'story', model: 'test', systemPrompt: 'System', userMessage: '[DELAY_MS:0][THOUGHTS:Thinking]Answer' }
  try {
    await streamTextProviderCompletion({ ...request, thinkingEffort: 'low' }, () => {}, new AbortController().signal)
    assert.equal(body.reasoning.effort, 'low')
    await streamTextProviderCompletion(request, () => {}, new AbortController().signal)
    assert.deepEqual(body.reasoning, { enabled: true, delta_field: 'reasoning_content' })
    globalThis.fetch = async () => { throw new Error('Fake must not use the network') }
    await streamTextProviderCompletion({ ...request, provider: 'fake', model: 'fake/test', thinkingEffort: 'high' }, () => {}, new AbortController().signal)
    assert.equal(getFakeProviderTrace().at(-1).thinkingEffort, 'high')
    await streamChatCompletion({ provider: 'fake', apiKey: '', baseUrl: '', model: 'fake/test', messages: [{ role: 'user', content: '[DELAY_MS:0]Answer' }], thinking: true, thinkingEffort: 'minimal' }, () => {}, new AbortController().signal)
    assert.equal(getFakeProviderTrace().at(-1).thinkingEffort, 'minimal')
  } finally { globalThis.fetch = originalFetch }
})
