import { useEffect, useRef, useState, type RefObject } from 'react'
import { getBookAiSettings, getBookProfileSelections } from '../../data/persistence'
import { AI_SETTINGS_EVENT, AI_SETTINGS_STORAGE_KEY, loadAiSettings, type AiSettings } from '../../shared/ai/ai-settings'
import { BOOK_PROFILE_SELECTIONS_STORAGE_KEY, SETTINGS_PROFILES_EVENT, SETTINGS_PROFILES_STORAGE_KEY, resolveProfileSettings, type BookProfileSelections } from '../settings/settings-profiles'
import type { EditorSelectionSnapshot, MarkdownEditorHandle } from '../editor/MarkdownEditor'
import { createAutocompleteController, type AutocompleteController, type AutocompleteSuggestion, type AutocompleteWritingSettings } from './autocomplete'

type SceneAutocompleteOptions = {
  bookId?: string
  sceneId?: string
  enabled: boolean
  busy: boolean
  writing: AutocompleteWritingSettings
  editor: RefObject<MarkdownEditorHandle | null>
  onError: () => void
}

function configurationKey(scope: string, profileId: string, settings: AiSettings) {
  // Runtime-only identity. Never persist or log connection credentials.
  return JSON.stringify([scope, profileId, settings.autocomplete, settings.provider, settings.apiKey, settings.baseUrl])
}

export function useSceneAutocomplete(options: SceneAutocompleteOptions) {
  const [suggestion, setSuggestion] = useState<AutocompleteSuggestion | null>(null)
  const latest = useRef(options)
  latest.current = options
  const scope = JSON.stringify([options.bookId, options.sceneId, options.writing])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const controller = useRef<AutocompleteController | null>(null)
  const inputSequence = useRef(0)
  const configuration = useRef<{ scope: string; selections: BookProfileSelections; key: string } | null>(null)
  const ready = useRef<AutocompleteSuggestion | null>(null)

  function isCurrent(snapshot: EditorSelectionSnapshot, key: string, requireFocus = true) {
    const current = latest.current
    const saved = configuration.current
    if (!current.enabled || current.busy || !saved || saved.scope !== scopeRef.current || saved.key !== key) return false
    try {
      const effective = resolveProfileSettings(saved.selections)
      if (configurationKey(saved.scope, saved.selections.text, effective) !== key) return false
    } catch { return false }
    return current.editor.current?.isAutocompleteSnapshotCurrent(snapshot, requireFocus) === true
  }

  function cancel() {
    inputSequence.current += 1
    controller.current?.cancel()
  }

  useEffect(() => {
    const instance = createAutocompleteController({
      isCurrent: (snapshot, key) => isCurrent(snapshot, key),
      onError: () => latest.current.onError(),
      onSuggestion: next => {
        const editor = latest.current.editor.current
        if (next && (!isCurrent(next.snapshot, next.configurationKey) || !editor?.setAutocompleteSuggestion(next.snapshot, next.text))) return
        if (!next) editor?.clearAutocompleteSuggestion()
        ready.current = next
        setSuggestion(next)
      },
    })
    controller.current = instance
    const changed = (event: Event) => {
      if (event.type === 'storage') {
        const { key, newValue } = event as StorageEvent
        if (key === BOOK_PROFILE_SELECTIONS_STORAGE_KEY) {
          try {
            if (JSON.parse(newValue ?? 'null')?.bookId !== latest.current.bookId) return
          } catch { return }
          configuration.current = null
          cancel()
          return
        }
        if (key !== null && ![AI_SETTINGS_STORAGE_KEY, SETTINGS_PROFILES_STORAGE_KEY].includes(key)) return
      }
      const bookId = (event as CustomEvent<{ bookId?: string }>).detail?.bookId
      if (bookId) {
        if (bookId !== latest.current.bookId) return
        // Book selection changes are asynchronous IndexedDB writes. Do not let
        // an old result through while the new selection is being resolved.
        configuration.current = null
        cancel()
        return
      }
      const saved = configuration.current
      if (!saved) return
      try {
        if (configurationKey(saved.scope, saved.selections.text, resolveProfileSettings(saved.selections)) === saved.key) return
      } catch { /* Invalid profiles fail closed, without exposing storage/provider details. */ }
      configuration.current = null
      cancel()
    }
    window.addEventListener(SETTINGS_PROFILES_EVENT, changed)
    window.addEventListener(AI_SETTINGS_EVENT, changed)
    window.addEventListener('storage', changed)
    return () => {
      inputSequence.current += 1
      window.removeEventListener(SETTINGS_PROFILES_EVENT, changed)
      window.removeEventListener(AI_SETTINGS_EVENT, changed)
      window.removeEventListener('storage', changed)
      instance.dispose()
      if (controller.current === instance) controller.current = null
    }
  }, [])

  useEffect(() => { configuration.current = null; cancel() }, [scope, options.enabled, options.busy])

  async function onInput(snapshot: EditorSelectionSnapshot) {
    cancel()
    const current = latest.current
    const inputScope = scopeRef.current
    const sequence = inputSequence.current
    if (!current.enabled || current.busy || !current.bookId || !current.sceneId) return
    try {
      const selections = await getBookProfileSelections(current.bookId)
      const settings = await getBookAiSettings(current.bookId, loadAiSettings().favorites)
      if (sequence !== inputSequence.current || inputScope !== scopeRef.current || !controller.current
        || !latest.current.enabled || latest.current.busy || !current.editor.current?.isAutocompleteSnapshotCurrent(snapshot)) return
      const key = configurationKey(inputScope, selections.text, settings)
      configuration.current = { scope: inputScope, selections, key }
      controller.current.schedule({ snapshot, settings, writing: current.writing, configurationKey: key })
    } catch {
      if (sequence === inputSequence.current && inputScope === scopeRef.current && current.editor.current?.isAutocompleteSnapshotCurrent(snapshot)) latest.current.onError()
    }
  }

  function accept() {
    const next = ready.current
    if (!next || !isCurrent(next.snapshot, next.configurationKey, false)) { cancel(); return false }
    const accepted = latest.current.editor.current?.acceptAutocompleteSuggestion(next.snapshot, next.text) === true
    cancel()
    return accepted
  }

  return { suggestion, onInput, cancel, accept }
}
