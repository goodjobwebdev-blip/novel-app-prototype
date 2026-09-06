from pathlib import Path

path = Path('src/App.tsx')
source = path.read_text()

ai_import = "import { clearModelCatalog, getCachedModelCatalog, providerModelEndpoint, saveModelCatalog, type ProviderModel } from './model-catalog'\n"
queue_import = "import { KeyedAsyncQueue } from './keyed-async-queue'\n"
if queue_import not in source:
    if ai_import not in source:
        raise SystemExit('model catalog import anchor not found')
    source = source.replace(ai_import, ai_import + queue_import, 1)

old_queue_ref = "  const aiSaveQueueRef = useRef<Promise<void>>(Promise.resolve())\n"
new_queue_ref = "  const aiSaveQueueRef = useRef(new KeyedAsyncQueue())\n"
if new_queue_ref not in source:
    if old_queue_ref not in source:
        raise SystemExit('AI save queue ref anchor not found')
    source = source.replace(old_queue_ref, new_queue_ref, 1)

old_persist = '''  function persistAiSettings(snapshot: AiSettings, scope: string, version: number) {
    const pending = aiSaveQueueRef.current.catch(() => undefined).then(async () => {
      const savedSettings = scope === 'defaults'
        ? saveAiSettings(snapshot)
        : await saveBookAiSettings(scope, snapshot)
      if (scope !== 'defaults') saveGlobalFavorites(snapshot.favorites)
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      aiSavedRef.current = JSON.stringify(snapshot)
      setSaveState('saved')
      setStatus(scope === 'defaults' ? 'AI defaults saved automatically on this device.' : `AI settings saved automatically for “${book?.title ?? 'this book'}”.`)
      setStatusKind('success')
      onSavedRef.current?.(savedSettings)
    })
    aiSaveQueueRef.current = pending
    return pending.catch(() => {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setStatus('Settings could not be saved. Your changes are still shown; edit a setting to try again.')
      setStatusKind('error')
    })
  }
'''
new_persist = '''  function persistAiSettings(snapshot: AiSettings, scope: string, version: number) {
    const pending = aiSaveQueueRef.current.run(scope, async () => {
      const savedSettings = scope === 'defaults'
        ? saveAiSettings(snapshot)
        : await saveBookAiSettings(scope, snapshot)
      if (scope !== 'defaults') saveGlobalFavorites(snapshot.favorites)
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      aiSavedRef.current = JSON.stringify(snapshot)
      setSaveState('saved')
      setStatus(scope === 'defaults' ? 'AI defaults saved automatically on this device.' : `AI settings saved automatically for “${book?.title ?? 'this book'}”.`)
      setStatusKind('success')
      onSavedRef.current?.(savedSettings)
    })
    return pending.catch(() => {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setStatus('Settings could not be saved. Your changes are still shown; edit a setting to try again.')
      setStatusKind('error')
    })
  }
'''
if new_persist not in source:
    if old_persist not in source:
        raise SystemExit('persistAiSettings block anchor not found')
    source = source.replace(old_persist, new_persist, 1)

old_reset = '''  async function resetFromDefaults() {
    if (!book || !window.confirm(`Replace the AI settings for “${book.title}” with the current defaults?`)) return
    invalidateModelRefresh()
    try {
      const defaults = loadAiSettings()
      const copied = await copyDefaultAiSettingsToBook(book.id, defaults)
      if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
      aiSaveTimerRef.current = null
      aiSaveVersionRef.current += 1
      latestAiSettingsRef.current = copied
      aiSavedRef.current = JSON.stringify(copied)
      setSettings(copied)
      setSaveState('saved')
      setModels(getCachedModelCatalog(copied)?.models ?? [])
      setStatus(`Current defaults copied to “${book.title}”.`)
      setStatusKind('success')
      onSaved?.(copied)
    } catch {
      setStatus('Defaults could not be copied to this book. Try again.')
      setStatusKind('error')
    }
  }
'''
new_reset = '''  async function resetFromDefaults() {
    if (!book || !window.confirm(`Replace the AI settings for “${book.title}” with the current defaults?`)) return
    invalidateModelRefresh()
    const scope = book.id
    const defaults = loadAiSettings()
    if (aiSaveTimerRef.current !== null) window.clearTimeout(aiSaveTimerRef.current)
    aiSaveTimerRef.current = null
    const version = ++aiSaveVersionRef.current

    // Reset becomes the newest local revision immediately, so any edit made while the
    // queued reset is waiting starts from the defaults and is ordered after the reset.
    latestAiSettingsRef.current = defaults
    setSettings(defaults)
    setSaveState('saving')
    setModels(getCachedModelCatalog(defaults)?.models ?? [])

    try {
      await aiSaveQueueRef.current.run(scope, async () => {
        const copied = await copyDefaultAiSettingsToBook(scope, defaults)
        if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
        latestAiSettingsRef.current = copied
        aiSavedRef.current = JSON.stringify(copied)
        setSettings(copied)
        setSaveState('saved')
        setModels(getCachedModelCatalog(copied)?.models ?? [])
        setStatus(`Current defaults copied to “${book.title}”.`)
        setStatusKind('success')
        onSavedRef.current?.(copied)
      })
    } catch {
      if (version !== aiSaveVersionRef.current || scope !== aiLoadedScopeRef.current) return
      setSaveState('error')
      setStatus('Defaults could not be copied to this book. Try again.')
      setStatusKind('error')
    }
  }
'''
if new_reset not in source:
    if old_reset not in source:
        raise SystemExit('resetFromDefaults block anchor not found')
    source = source.replace(old_reset, new_reset, 1)

path.write_text(source)

Path('tests/ai-settings-reset-order.test.mjs').write_text(r'''import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { KeyedAsyncQueue } from '../src/keyed-async-queue.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function block(startText, endText) {
  const start = appSource.indexOf(startText)
  const end = appSource.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `${startText} block exists`)
  return appSource.slice(start, end)
}

test('AI autosaves and explicit reset share the same per-scope FIFO queue', () => {
  assert.match(appSource, /const aiSaveQueueRef = useRef\(new KeyedAsyncQueue\(\)\)/)
  const persist = block('  function persistAiSettings(', '\n  function scheduleAiSettingsSave')
  const reset = block('  async function resetFromDefaults()', '\n  async function saveContextDefaults')
  assert.match(persist, /aiSaveQueueRef\.current\.run\(scope/)
  assert.match(reset, /aiSaveQueueRef\.current\.run\(scope/)
})

test('reset cancels pending debounce and reserves its revision before entering the queue', () => {
  const reset = block('  async function resetFromDefaults()', '\n  async function saveContextDefaults')
  const clearTimer = reset.indexOf('window.clearTimeout(aiSaveTimerRef.current)')
  const reserveVersion = reset.indexOf('const version = ++aiSaveVersionRef.current')
  const optimisticDefaults = reset.indexOf('latestAiSettingsRef.current = defaults')
  const enqueue = reset.indexOf('aiSaveQueueRef.current.run(scope')
  assert.ok(clearTimer >= 0 && reserveVersion > clearTimer, 'pending debounce is cancelled before Reset reserves a revision')
  assert.ok(optimisticDefaults > reserveVersion && enqueue > optimisticDefaults, 'Reset becomes the local latest revision before its durable write queues')
})

test('older in-flight autosave cannot overwrite a later queued reset', async () => {
  const queue = new KeyedAsyncQueue()
  let persisted = 'O'
  let releaseAutosave
  let resetCompleted = false
  const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve })

  const autosaveA = queue.run('book-a', async () => {
    await autosaveGate
    persisted = 'A'
  })
  const resetD = queue.run('book-a', async () => {
    persisted = 'D'
    resetCompleted = true
  })

  await Promise.resolve()
  assert.equal(resetCompleted, false, 'Reset waits behind the already-started autosave')
  releaseAutosave()
  await Promise.all([autosaveA, resetD])
  assert.equal(persisted, 'D', 'Reset is the latest durable revision')
})

test('post-reset edit intentionally supersedes the reset', async () => {
  const queue = new KeyedAsyncQueue()
  let persisted = 'O'
  let releaseAutosave
  const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve })

  const autosaveA = queue.run('book-a', async () => {
    await autosaveGate
    persisted = 'A'
  })
  const resetD = queue.run('book-a', async () => { persisted = 'D' })
  const editB = queue.run('book-a', async () => { persisted = 'B' })

  releaseAutosave()
  await Promise.all([autosaveA, resetD, editB])
  assert.equal(persisted, 'B')
})
''')
