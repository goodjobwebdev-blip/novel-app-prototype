import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
registerHooks({ resolve(specifier, context, nextResolve) { if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) { const url = new URL(specifier + '.ts', context.parentURL); if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context) } return nextResolve(specifier, context) } })
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const p = await import('../src/persistence.ts')
const { initialAiSettings, copyAiSettings } = await import('../src/ai-settings.ts')
const { encodeDocumentBlock } = await import('../src/document-projection.ts')
const { sensoryPrompts } = await import('../src/prose-transformations.ts')
const { createSensoryVariantParser, prepareSensoryDetailRequest, validSensoryReplacement } = await import('../src/sensory-details.ts')
after(async () => (await p.database()).close())
const idea = (sense, index = 1) => ({ sense, label: `${sense} idea ${index}`, text: `She paused, noticing ${sense} detail ${index}.` })

test('complete ideas stream before EOF, including escaped paragraphs and split Unicode', () => {
  const received = []
  const parser = createSensoryVariantParser('She paused.', [], variant => received.push(variant))
  const first = { ...idea('sight'), text: 'She paused.\n\nThe café lights flickered.' }
  const line = JSON.stringify(first)
  parser.push(line.slice(0, 21))
  assert.equal(received.length, 0)
  parser.push(line.slice(21) + '\n')
  assert.equal(received[0].text, first.text)
  const rest = sensoryPrompts.flatMap(sense => [1, 2].map(index => idea(sense.id, index))).filter(item => !(item.sense === 'sight' && item.label === first.label))
  for (const item of rest) parser.push(JSON.stringify(item) + '\n')
  assert.equal(received.length, 14)
  assert.equal(parser.finish().length, 14)
  assert.equal(new Set(received.map(item => item.id)).size, 14)
  for (const sense of sensoryPrompts) assert.equal(received.filter(item => item.sense === sense.id).length, 2)
})

test('suggestions reject unknown senses, originals, duplicates and protected blocks', () => {
  const block = encodeDocumentBlock({ id: 'hidden', type: 'comment', text: 'Do not insert' })
  const existing = { id: 'old', ...idea('sound') }
  const received = []
  const parser = createSensoryVariantParser('She paused.', [existing], variant => received.push(variant))
  for (const item of [null, { ...idea('unknown') }, { ...idea('sight'), text: ' SHE PAUSED. ' }, existing, { ...idea('sight'), text: block }, { ...idea('sight'), label: '' }, idea('sight'), { ...idea('sight'), text: idea('sight').text.toUpperCase() }, idea('sight', 2), idea('sight', 3)]) parser.push(JSON.stringify(item) + '\n')
  assert.deepEqual(parser.finish().map(item => item.text), [idea('sight').text, idea('sight', 2).text])
  assert.equal(validSensoryReplacement(' '), false)
  assert.equal(validSensoryReplacement(block), false)
  assert.equal(validSensoryReplacement('Her hands **ached** with cold.'), true)
})

test('array fallback, final lines and invalid responses have predictable outcomes', () => {
  for (const output of [JSON.stringify(idea('smell')), '```json\n' + JSON.stringify({ variants: [idea('smell')] }, null, 2) + '\n```', JSON.stringify([idea('smell')])]) {
    const received = []
    const parser = createSensoryVariantParser('Original.', [], item => received.push(item))
    parser.push(output)
    assert.equal(parser.finish().length, 1)
    assert.equal(received.length, 1)
  }
  const parser = createSensoryVariantParser('Original.', [], () => {})
  parser.push('Here are some ideas: {"sense":')
  assert.throws(() => parser.finish(), /No new usable/)
  assert.throws(() => parser.push('x'.repeat(500_001)), /too long/)
})

test('sensory requests preserve Main settings and prose context with a distinct structured output contract', async () => {
  const settings = copyAiSettings(initialAiSettings)
  Object.assign(settings, { provider: 'fake', mainModel: 'fake/main', supportModel: 'fake/support', mainModelContextLength: 100000, mainThinkingEffort: 'low' })
  const fixture = await p.createBook(settings, 'Sensory test')
  const hidden = encodeDocumentBlock({ id: 'hidden', type: 'comment', text: 'PRIVATE_SENTINEL' })
  const source = `Before.\n\n${hidden}\n\n**She paused.**\n\nAfter.`
  const selected = '**She paused.**', from = source.indexOf(selected)
  const capture = { bookId: fixture.book.id, book: { title: fixture.book.title }, document: { ...fixture.scene, language: 'French' }, snapshot: { editorId: 'editor', revision: 1, document: source, from, to: from + selected.length, text: selected } }
  const result = await prepareSensoryDetailRequest(capture, [{ id: 'old', ...idea('sound') }], new AbortController().signal)
  assert.equal(result.model, 'fake/main')
  assert.equal(result.settings.mainThinkingEffort, 'low')
  const text = result.request.providerMessages.map(message => message.content).join('\n')
  assert.match(text, /newline-delimited JSON/)
  assert.match(text, /ENTIRE selected passage/)
  assert.match(text, /language: French \(Scene override\)/)
  assert.match(text, /sound idea 1/)
  assert.doesNotMatch(text, /PRIVATE_SENTINEL|Return replacement prose only/)
  assert.equal(text.split('**She paused.**').length - 1, 1)
  for (const sense of sensoryPrompts) assert.ok(text.includes(sense.id + ': ' + sense.label))
})
