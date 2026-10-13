import { codexTitleTriggerSuggestions } from './codex-trigger-service'

export default function CodexTriggerSuggestions({ title, value, disabled, onAdd }: {
  title: string
  value: string
  disabled: boolean
  onAdd: (trigger: string) => void
}) {
  const suggestions = codexTitleTriggerSuggestions(title, value.split(/\r?\n/))
  if (!suggestions.length) return null
  return <div className="codex-trigger-suggestions" aria-label="Suggested automatic triggers">
    <span>Add from name:</span>
    {suggestions.map(trigger => <button key={trigger} type="button" disabled={disabled} aria-label={`Add trigger: ${trigger}`} onPointerDown={event => event.preventDefault()} onClick={() => onAdd(trigger)}>{trigger}</button>)}
  </div>
}
