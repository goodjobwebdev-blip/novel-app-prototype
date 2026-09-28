import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { resolveSceneWriting, sceneWritingFields, sceneWritingLabels, sceneWritingValues, type SceneWritingOverrides } from './scene-writing'
import type { BookPromptValues } from '../../shared/ai/prompt-template'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'

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
      {sceneWritingFields.map((field) => <div key={field} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end', gap: '.5rem' }}><Input label={sceneWritingLabels[field]} disabled={disabled || saving} value={draft[field]} placeholder={`Inherit: ${effective[field === 'writingStyle' ? 'style' : field].origin === 'Book default' ? effective[field === 'writingStyle' ? 'style' : field].value || 'not set' : book[field === 'writingStyle' ? 'style' : field] || 'not set'}`} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} /><Button variant="ghost" disabled={disabled || saving || !draft[field]} onClick={() => setDraft((current) => ({ ...current, [field]: '' }))}>Reset</Button></div>)}
      {error && <p role="alert">{error}</p>}
      <footer><Button variant="ghost" disabled={disabled || saving} onClick={() => setDraft({ pov: '', tense: '', writingStyle: '', language: '' })}>Reset all</Button><Button type="submit" variant="primary" disabled={disabled || saving || JSON.stringify(draft) === signature}>{saving ? 'Saving…' : 'Save scene settings'}</Button></footer>
    </form>
  </details>
}
