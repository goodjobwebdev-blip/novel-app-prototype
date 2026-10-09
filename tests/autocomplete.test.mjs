import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
const { buildAutocompleteContext, buildAutocompleteRequest, autocompleteIsConfigured, sanitizeAutocompleteCompletion, createAutocompleteController } = await import('../src/features/writing/autocomplete.ts')
const { encodeDocumentBlock } = await import('../src/features/editor/document-projection.ts')
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function snapshot(document = 'The door opened', revision = 1) {
  return { editorId: 'editor-one', revision, document, from: document.length, to: document.length, text: '' }
}
function settings(overrides = {}) {
  return {
    provider: 'fake', apiKey: '', baseUrl: '', mainModel: '',
    autocomplete: { enabled: true, model: 'fake/test', delayMs: 800, length: 'phrase' },
    prompts: { story: 'STORY_SECRET' }, promptCompositions: { story: 'PRESET_SECRET' },
    ...overrides,
  }
}
function input(document, overrides = {}) {
  return { snapshot: snapshot(document), settings: settings(), writing: { pov: 'third', tense: 'past', style: 'spare', language: 'English' }, configurationKey: 'opaque:key', ...overrides }
}
function harness(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = [], suggestions = [], errors = []
  const controller = createAutocompleteController({
    onSuggestion: value => suggestions.push(value),
    onError: (...args) => errors.push(args.length),
    isCurrent: options.isCurrent ?? (() => true),
    request: options.request ?? ((request, signal) => new Promise((resolve, reject) => calls.push({ request, signal, resolve, reject }))),
  })
  t.after(() => { controller.dispose(); for (const call of calls) call.resolve('') })
  return { controller, calls, suggestions, errors, tick: ms => t.mock.timers.tick(ms), shown: () => suggestions.filter(Boolean) }
}

test('context caps the last 500 prose words after private blocks, images and code are excluded', () => {
  const words = Array.from({ length: 520 }, (_, i) => `word${i}`).join(' ')
  const privateBlock = encodeDocumentBlock({ id: 'private', type: 'comment', text: 'PRIVATE_SECRET '.repeat(700) })
  const source = `Old prose.\n${privateBlock}\n<!-- malformed PRIVATE_SECRET -->\n![IMAGE_SECRET](https://image.invalid/private)\n<figure>FIGURE_SECRET</figure>\n\`INLINE_SECRET\`\n\n\`\`\`js\nCODE_SECRET\n\`\`\`\n\n    INDENT_SECRET\n\n${words}  `
  const context = buildAutocompleteContext(source)
  assert.equal(context, Array.from({ length: 500 }, (_, i) => `word${i + 20}`).join(' ') + '  ')
  assert.doesNotMatch(context, /SECRET|word19\b/)
  const short = buildAutocompleteContext('Before<!-- PRIVATE -->after \`CODE\` prose.')
  assert.match(short, /Before\s+after/)
  assert.doesNotMatch(short, /PRIVATE|CODE/)
  assert.equal(buildAutocompleteContext('Before<!-- unterminated PRIVATE'), 'Before\n')
  assert.equal(buildAutocompleteContext('first second third', 12), 'first second')
  assert.equal(buildAutocompleteContext('<!-- only private -->'), '')
})

test('request contains only local manuscript and explicit scene settings; model and ceiling are independent of Main', () => {
  const request = buildAutocompleteRequest(input('Prose<!--PRIVATE--> continues'))
  assert.equal(request.task, 'autocomplete')
  assert.equal(request.model, 'fake/test')
  assert.equal(request.maxTokens, 64)
  assert.equal(request.thinking, false)
  assert.equal(request.messages.length, 2)
  assert.equal(request.messages[0].role, 'system')
  assert.equal(request.messages[1].role, 'user')
  const data = JSON.parse(request.messages[1].content)
  assert.equal(data.writing.pov, 'third')
  assert.equal(data.writing.tense, 'past')
  assert.equal(data.writing.style, 'spare')
  assert.equal(data.writing.language, 'English')
  assert.match(data.manuscript, /Prose\s+continues/)
  assert.doesNotMatch(JSON.stringify(request), /PRIVATE|STORY_SECRET|PRESET_SECRET|Codex/)
  const sentenceSettings = settings({ autocomplete: { enabled: true, model: 'fake/test', delayMs: 100, length: 'sentence' } })
  assert.equal(buildAutocompleteRequest(input('Prose', { settings: sentenceSettings })).maxTokens, 128)
})

test('unsupported, disabled, missing model or connection, selection and protected/code endings do not request', () => {
  for (const configured of [settings({ autocomplete: { enabled: false, model: 'fake/test' } }), settings({ autocomplete: { enabled: true, model: '' } }), settings({ provider: 'openai', apiKey: 'key' }), settings({ provider: 'nanogpt' }), settings({ provider: 'litellm', apiKey: 'key' }), settings({ autocomplete: undefined })]) {
    assert.equal(autocompleteIsConfigured(configured), false)
    assert.equal(buildAutocompleteRequest(input('Prose', { settings: configured })), null)
  }
  assert.equal(autocompleteIsConfigured(settings({ provider: 'nanogpt', apiKey: 'key' })), true)
  assert.equal(autocompleteIsConfigured(settings({ provider: 'litellm', apiKey: 'key', baseUrl: 'https://local.invalid/v1' })), true)
  for (const document of ['', '<!-- private -->', 'Prose<!-- unfinished', 'Prose\n\n```js\ncode', 'Prose\n\n    code', 'Prose `unfinished', 'Prose `code`']) assert.equal(buildAutocompleteRequest(input(document)), null)
  assert.equal(buildAutocompleteRequest(input('Prose', { snapshot: { ...snapshot('Prose'), from: 1 } })), null)
  assert.equal(buildAutocompleteRequest(input('Prose', { snapshot: { ...snapshot('Prose'), from: 2, to: 2 } })), null)
})

test('sanitization rejects markup, repeated tails, oversized and explanatory outputs without truncation', () => {
  for (const response of ['', '  ', '```text\nanswer\n```', '<!--private-->', '<img src=x>', '# Heading', '- list', '![image](url)', '[link](url)', '**bold**', '*emphasis*', '{{hidden}}', 'arc:passage', 'Sure: more prose', 'First\nSecond', 'hidden\u200btext', 'x'.repeat(241), 'word '.repeat(33), 'The door opened', 'The door opened and closed']) {
    assert.equal(sanitizeAutocompleteCompletion(response, 'The door opened', 'phrase'), null, response.slice(0, 50))
  }
  assert.equal(sanitizeAutocompleteCompletion('x'.repeat(601), 'Before', 'sentence'), null)
  assert.equal(sanitizeAutocompleteCompletion('word '.repeat(81), 'Before', 'sentence'), null)
  assert.equal(sanitizeAutocompleteCompletion(' into the hall.', 'The door opened', 'sentence'), ' into the hall.')
})

test('joining respects model word suffixes, existing whitespace, punctuation and newlines', () => {
  for (const [before, response, expected] of [
    ['unfin', 'ished', 'ished'], ['The door opened', ' quietly', ' quietly'],
    ['The door opened ', ' quietly  ', 'quietly'], ['The door opened', ' , slowly', ', slowly'],
    ['The door opened.', 'Then', ' Then'], ['The door opened\n', '\nThen', 'Then'],
    ['The door opened', '\nThen', '\nThen'], ['「物語', 'の続き」', 'の続き」'],
  ]) assert.equal(sanitizeAutocompleteCompletion(response, before, 'sentence'), expected)
})

test('debounce restarts on new input, sends exactly once, and publishes only the complete response', async t => {
  const h = harness(t)
  h.controller.schedule(input('The door'))
  h.tick(799)
  assert.equal(h.calls.length, 0)
  h.controller.schedule(input('The door opened'))
  h.tick(799)
  assert.equal(h.calls.length, 0)
  h.tick(1)
  assert.equal(h.calls.length, 1)
  assert.equal(h.shown().length, 0)
  h.calls[0].resolve(' quietly')
  await nextTurn()
  assert.equal(h.shown().length, 1)
  assert.equal(h.shown()[0].text, ' quietly')
  assert.equal(h.shown()[0].snapshot.document, 'The door opened')
  assert.equal(h.shown()[0].configurationKey, 'opaque:key')
  h.tick(20_000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 0)
})

test('new input aborts old work; late results and late errors cannot replace the newer suggestion', async t => {
  const h = harness(t)
  h.controller.schedule(input('First'))
  h.tick(800)
  h.controller.schedule(input('Second'))
  assert.equal(h.calls[0].signal.aborted, true)
  h.tick(800)
  assert.equal(h.calls.length, 2)
  h.calls[1].resolve(' continued')
  await nextTurn()
  h.calls[0].resolve(' stale')
  await nextTurn()
  assert.equal(h.shown().length, 1)
  assert.equal(h.shown()[0].snapshot.document, 'Second')
  assert.equal(h.errors.length, 0)
})

test('isCurrent gates both launch and completion, including opaque configuration changes', async t => {
  let current = false
  const h = harness(t, { isCurrent: () => current })
  h.controller.schedule(input('First'))
  h.tick(800)
  assert.equal(h.calls.length, 0)
  current = true
  h.controller.schedule(input('Second'))
  h.tick(800)
  current = false
  h.calls[0].resolve(' stale')
  await nextTurn()
  assert.equal(h.shown().length, 0)
  assert.equal(h.errors.length, 0)
  current = true
  h.controller.schedule(input('Second', { configurationKey: 'different opaque key' }))
  h.tick(800)
  h.calls[1].resolve(' current')
  await nextTurn()
  assert.equal(h.shown()[0].configurationKey, 'different opaque key')
})

test('cancel/dispose are quiet, clear suggestions and suppress unchanged retries after rejection or acceptance', async t => {
  const h = harness(t)
  h.controller.schedule(input('First'))
  h.controller.cancel()
  h.controller.schedule(input('First'))
  h.tick(800)
  assert.equal(h.calls.length, 0)
  h.controller.schedule(input('Second'))
  h.tick(800)
  h.controller.cancel()
  h.calls[0].reject(new Error('SECRET manuscript API key'))
  await nextTurn()
  h.controller.schedule(input('Second'))
  h.tick(800)
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 0)
  assert.equal(h.shown().length, 0)
  h.controller.schedule(input('Third'))
  h.controller.dispose()
  h.controller.schedule(input('Fourth'))
  h.tick(20_000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.suggestions.at(-1), null)
})

test('timeout covers the entire response, aborts once with a generic callback, and never retries', async t => {
  const h = harness(t)
  h.controller.schedule(input('Before'))
  h.tick(800)
  h.tick(9_999)
  assert.equal(h.calls[0].signal.aborted, false)
  assert.equal(h.errors.length, 0)
  h.tick(1)
  assert.equal(h.calls[0].signal.aborted, true)
  assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0], 0)
  h.calls[0].resolve(' late full response')
  await nextTurn()
  h.tick(30_000)
  assert.equal(h.shown().length, 0)
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 1)
})

test('errors notify without forwarding secrets, while empty or unsuitable replies are silently discarded', async t => {
  const h = harness(t)
  h.controller.schedule(input('First'))
  h.tick(800)
  h.calls[0].reject(new Error('SECRET key and manuscript'))
  await nextTurn()
  assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0], 0)
  for (const [document, response] of [['Second', ''], ['Third', '<!-- private -->']]) {
    h.controller.schedule(input(document))
    h.tick(800)
    h.calls.at(-1).resolve(response)
    await nextTurn()
  }
  h.tick(20_000)
  assert.equal(h.calls.length, 3)
  assert.equal(h.errors.length, 1)
  assert.equal(h.shown().length, 0)
})

test('disabled settings cancel an already scheduled attempt even with the same opaque key', t => {
  const h = harness(t)
  h.controller.schedule(input('Before'))
  h.controller.schedule(input('Before', { settings: settings({ autocomplete: { enabled: false, model: 'fake/test', delayMs: 800, length: 'phrase' } }) }))
  h.tick(20_000)
  assert.equal(h.calls.length, 0)
  assert.equal(h.errors.length, 0)
})

test('delay uses the 800ms default and clamps scheduling to the 100..10000ms range', async t => {
  const h = harness(t)
  for (const [delayMs, expected, document] of [[NaN, 800, 'Default'], [0, 100, 'Minimum'], [99_999, 10_000, 'Maximum']]) {
    const count = h.calls.length
    h.controller.schedule(input(document, { settings: settings({ autocomplete: { enabled: true, model: 'fake/test', length: 'phrase', delayMs } }) }))
    h.tick(expected - 1)
    assert.equal(h.calls.length, count)
    h.tick(1)
    assert.equal(h.calls.length, count + 1)
    h.calls.at(-1).resolve(' continuation')
    await nextTurn()
  }
  assert.equal(h.errors.length, 0)
})

test('stale provider errors are quiet and a cancelled timeout cannot report an error', async t => {
  let current = true
  const h = harness(t, { isCurrent: () => current })
  h.controller.schedule(input('First'))
  h.tick(800)
  current = false
  h.calls[0].reject(new Error('private provider error'))
  await nextTurn()
  current = true
  h.controller.schedule(input('Second'))
  h.tick(800)
  h.controller.cancel()
  h.tick(10_000)
  h.calls[1].resolve(' too late')
  await nextTurn()
  assert.equal(h.errors.length, 0)
  assert.equal(h.shown().length, 0)
})

test('scheduled requests capture settings and snapshot rather than observing later mutations', async t => {
  const h = harness(t)
  const captured = input('Original')
  h.controller.schedule(captured)
  captured.snapshot.document = 'Mutated'
  captured.settings.autocomplete.model = 'mutated/model'
  captured.writing.style = 'mutated style'
  h.tick(800)
  assert.equal(h.calls[0].request.model, 'fake/test')
  assert.equal(JSON.parse(h.calls[0].request.messages[1].content).writing.style, 'spare')
  h.calls[0].resolve(' continuation')
  await nextTurn()
  assert.equal(h.shown()[0].snapshot.document, 'Original')
})
