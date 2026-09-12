import test from 'node:test'
import assert from 'node:assert/strict'
import { findDialogueRanges } from '../src/dialogue-highlighting.ts'

const dialogue = (text, excluded) => findDialogueRanges(text, excluded).map(({ from, to }) => text.slice(from, to))

test('dialogue recognizes straight, curly, single, guillemet and low-opening quotes', () => {
  assert.deepEqual(dialogue('She said "Hello." Then “Goodbye.” And «Until tomorrow!»'), ['Hello.', 'Goodbye.', 'Until tomorrow!'])
  assert.deepEqual(dialogue("'Hello,' she said. ‘I’m here.’ „Guten Tag.“ ‹Bonjour.›"), ['Hello,', 'I’m here.', 'Guten Tag.', 'Bonjour.'])
  assert.deepEqual(dialogue('Он сказал: «Привет, мир!»'), ['Привет, мир!'])
})

test('apostrophes, measurements, empty quotes and escaped delimiters are not dialogue', () => {
  assert.deepEqual(dialogue(`John's coat isn't here. The sailors’ ship is 6' 2" tall. "" “ ”`), [])
  assert.deepEqual(dialogue(String.raw`She said "Don't call it \"magic\"."`), [String.raw`Don't call it \"magic\".`])
  assert.deepEqual(dialogue(String.raw`An escaped \"word\" and \'another\'.`), [])
  assert.deepEqual(dialogue(`'I don't know,' she said. “He called it ‘home’.”`), ["I don't know,", 'He called it ‘home’.'])
})

test('wrapped dialogue and continued speeches work without an unfinished quote bleeding into narration', () => {
  assert.deepEqual(dialogue('“First line\nsecond line.”'), ['First line\nsecond line.'])
  assert.deepEqual(dialogue('“First paragraph.\n\n“Second paragraph.”\n\nNarration.'), ['First paragraph.', 'Second paragraph.'])
  assert.deepEqual(dialogue('“Unfinished\n\nNarration. “Complete.”'), ['Complete.'])
  assert.deepEqual(dialogue('“Still typing'), [])
})

test('excluded Markdown and metadata quotes neither create dialogue nor receive styling', () => {
  const text = '“Run `"go"` now.” Then `"ignore"`.'
  const blocks = [...text.matchAll(/`[^`]+`/g)].map(match => ({ from: match.index, to: match.index + match[0].length }))
  assert.deepEqual(dialogue(text, blocks), ['Run ', ' now.'])
  assert.deepEqual(dialogue(text, [...blocks, ...blocks]), ['Run ', ' now.'])
})
