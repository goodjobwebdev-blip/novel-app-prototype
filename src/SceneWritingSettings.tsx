import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { resolveSceneWriting, sceneWritingFields, sceneWritingLabels, sceneWritingValues, type SceneWritingOverrides } from './scene-writing'
import type { BookPromptValues } from './prompt-template'

export default function SceneWritingSettings({ scene, book, disabled, onSave }: {
  scene: Record<string, unknown>; book: BookPromptValues; disabled: boolean
  onSave: (patch: SceneWritingOverrides, before: SceneWritingOverrides) => Promise<void>
}) {
  const values = sceneWritingValues(scene)
  const signature = JSON.stringify(values)
  const [draft, setDraft] = useState(values)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(sceneWritingValues(scene)); setError('') }, [scene.id, signature])
  const effective = resolveSceneWriting(book, values)
  return <details className="scene-writing-settings">
    <summary><span>{effective.pov.value || 'POV unset'} · {effective.tense.value || 'Tense unset'}</span><small>{Object.values(values).some(Boolean) ? 'Overrides' : 'Inherit from book'}</small><ChevronDown size={16} /></summary>
    <form onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(''); try { await onSave(draft, values) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save settings.') } finally { setSaving(false) } }}>
      <p>Empty fields inherit the current book default.</p>
      {sceneWritingFields.map((field) => <label key={field}><span>{sceneWritingLabels[field]}</span><div><input disabled={disabled || saving} value={draft[field]} placeholder={`Inherit: ${effective[field === 'writingStyle' ? 'style' : field].origin === 'Book default' ? effective[field === 'writingStyle' ? 'style' : field].value || 'not set' : book[field === 'writingStyle' ? 'style' : field] || 'not set'}`} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} /><button type="button" disabled={disabled || saving || !draft[field]} onClick={() => setDraft((current) => ({ ...current, [field]: '' }))}>Reset</button></div></label>)}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={disabled || saving} onClick={() => setDraft({ pov: '', tense: '', writingStyle: '', language: '' })}>Reset all</button><button type="submit" disabled={disabled || saving || JSON.stringify(draft) === signature}>{saving ? 'Saving…' : 'Save scene settings'}</button></footer>
    </form>
  </details>
}
