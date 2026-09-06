import { useEffect, useState } from 'react'
import type { PromptComposition } from './prompt-composition'
import {
  applyPromptCompositionPreset,
  deletePromptCompositionPreset,
  duplicatePromptCompositionPreset,
  promptPresetsForScope,
  renamePromptCompositionPreset,
  savePromptCompositionPreset,
  type PromptCompositionPreset,
  type PromptPresetScope,
} from './prompt-presets'
import './prompt-presets.css'

const scopeLabels: Record<PromptPresetScope, string> = { story: 'Story', chat: 'Chat', codex: 'Codex', summary: 'Summary' }

export default function PromptPresetControls({ scope, composition, arcDefault, onApply }: {
  scope: PromptPresetScope
  composition: PromptComposition
  arcDefault: PromptComposition
  onApply: (composition: PromptComposition) => void
}) {
  const [presets, setPresets] = useState<PromptCompositionPreset[]>(() => promptPresetsForScope(scope, arcDefault))
  const [selectedId, setSelectedId] = useState(`arc-default:${scope}`)
  const [notice, setNotice] = useState('')

  const reload = (preferredId = selectedId) => {
    const next = promptPresetsForScope(scope, arcDefault)
    setPresets(next)
    setSelectedId(next.some((preset) => preset.id === preferredId) ? preferredId : next[0].id)
  }

  useEffect(() => {
    setNotice('')
    const next = promptPresetsForScope(scope, arcDefault)
    setPresets(next)
    setSelectedId(next[0].id)
  }, [scope, arcDefault])

  const selected = presets.find((preset) => preset.id === selectedId) ?? presets[0]

  function report(action: () => void) {
    try {
      action()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The preset operation failed.')
    }
  }

  function saveCurrent() {
    const entered = window.prompt(`Name this ${scopeLabels[scope]} composition preset`)
    if (entered === null || !entered.trim()) return
    const existing = presets.find((preset) => preset.kind === 'user' && preset.name.trim().toLocaleLowerCase() === entered.trim().toLocaleLowerCase())
    if (existing && !window.confirm(`Replace the existing preset “${existing.name}”?`)) return
    report(() => {
      const saved = savePromptCompositionPreset(scope, entered, composition, { replaceId: existing?.id })
      reload(saved.id)
      setNotice(`Saved “${saved.name}”, including disabled messages.`)
    })
  }

  function applySelected() {
    if (!selected || !window.confirm(`Replace the complete ${scopeLabels[scope]} prompt composition with “${selected.name}”?`)) return
    report(() => {
      onApply(applyPromptCompositionPreset(selected))
      setNotice(`Applied “${selected.name}”.`)
    })
  }

  function duplicate(preset: PromptCompositionPreset) {
    const entered = window.prompt('Name the duplicated preset', preset.kind === 'built-in' ? 'Arc default copy' : `${preset.name} copy`)
    if (entered === null || !entered.trim()) return
    report(() => {
      const saved = duplicatePromptCompositionPreset(preset, entered)
      reload(saved.id)
      setNotice(`Duplicated as “${saved.name}”.`)
    })
  }

  function rename(preset: PromptCompositionPreset) {
    const entered = window.prompt('Rename preset', preset.name)
    if (entered === null || !entered.trim()) return
    report(() => {
      const renamed = renamePromptCompositionPreset(preset.id, entered)
      reload(renamed.id)
      setNotice(`Renamed preset to “${renamed.name}”.`)
    })
  }

  function remove(preset: PromptCompositionPreset) {
    if (!window.confirm(`Delete preset “${preset.name}”?`)) return
    report(() => {
      deletePromptCompositionPreset(preset.id)
      reload()
      setNotice(`Deleted “${preset.name}”.`)
    })
  }

  return <section className="prompt-preset-controls" aria-label={`${scopeLabels[scope]} prompt composition presets`}>
    <div className="prompt-preset-picker">
      <label><span>Composition preset</span><select value={selected?.id ?? ''} onChange={(event) => { setSelectedId(event.target.value); setNotice('') }}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.kind === 'built-in' ? ' · built-in' : ''}</option>)}</select></label>
      <button type="button" onClick={applySelected}>Apply preset</button>
      <button type="button" onClick={saveCurrent}>Save current</button>
    </div>
    <small>Selecting a preset does not change the composition. Apply replaces the complete System prompt and predefined-message list.</small>
    {notice && <p className="prompt-preset-notice" role="status">{notice}</p>}
    <details className="prompt-preset-library"><summary>Manage presets</summary><div>{presets.map((preset) => <article key={preset.id}>
      <div><strong>{preset.name}</strong><span>{scopeLabels[preset.scope]} · {preset.kind === 'built-in' ? 'immutable built-in' : 'device-local user preset'} · {preset.predefinedMessages.length} message{preset.predefinedMessages.length === 1 ? '' : 's'}</span>{preset.updatedAt && <small>Updated {new Date(preset.updatedAt).toLocaleString()}</small>}</div>
      <div><button type="button" onClick={() => duplicate(preset)}>Duplicate</button>{preset.kind === 'user' && <><button type="button" onClick={() => rename(preset)}>Rename</button><button type="button" onClick={() => remove(preset)}>Delete</button></>}</div>
    </article>)}</div></details>
  </section>
}
