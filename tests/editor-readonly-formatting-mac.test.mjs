import { assertTestResourceLimits } from './test-resource-policy.mjs'
assertTestResourceLimits()
// Test files run in separate guarded processes. Initialize browser platform
// detection before loading CodeMirror; otherwise Cmd events on Linux are inert.
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', vendor: 'Apple Computer, Inc.', maxTouchPoints: 0 },
})
const { after } = await import('node:test')
after(() => {
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
  else delete globalThis.navigator
})
await import('./editor-readonly-formatting.test.mjs')
