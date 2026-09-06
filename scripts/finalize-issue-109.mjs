import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function replaceExact(path, before, after, expected = 1) {
  const source = readFileSync(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== expected) throw new Error(`${path}: expected ${expected} matches, found ${count}`)
  writeFileSync(path, source.split(before).join(after))
}

replaceExact(
  'src/fake-provider.ts',
  "export function subscribeFakeProviderTrace(listener: () => void) {\n  listeners.add(listener)\n  return () => listeners.delete(listener)\n}",
  "export function subscribeFakeProviderTrace(listener: () => void) {\n  listeners.add(listener)\n  return () => { listeners.delete(listener) }\n}",
)

replaceExact(
  'src/App.tsx',
  "<small>{provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small>",
  "<small>{provider === 'fake' ? 'Local · no network' : provider === 'compatible' ? 'Custom endpoint' : 'Managed endpoint'}</small>",
)

replaceExact(
  'src/chat-api.ts',
  "): Promise<ChatCompletionResult> {\n  if (request.provider === 'fake') {",
  "): Promise<ChatCompletionResult> {\n  const providerMessages = cacheFriendlyMessages(request.messages)\n  if (request.provider === 'fake') {",
)
replaceExact('src/chat-api.ts', '      messages: request.messages,', '      messages: providerMessages,')
replaceExact('src/chat-api.ts', '    messages: cacheFriendlyMessages(request.messages),', '    messages: providerMessages,')

replaceExact(
  'tests/fake-provider-integration.test.mjs',
  "/streamFakeProvider\\(\\{[\\s\\S]*messages: request\\.messages,[\\s\\S]*tools: request\\.tools,[\\s\\S]*thinking: request\\.thinking/",
  "/const providerMessages = cacheFriendlyMessages\\(request\\.messages\\)[\\s\\S]*streamFakeProvider\\(\\{[\\s\\S]*messages: providerMessages,[\\s\\S]*tools: request\\.tools,[\\s\\S]*thinking: request\\.thinking/",
)

rmSync('.github/workflows/issue-109-finalize.yml', { force: true })
rmSync('scripts/finalize-issue-109.mjs', { force: true })
