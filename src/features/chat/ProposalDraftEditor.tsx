import { useLoreTypes } from '../codex/LoreTypesControls'
import { useEffect, useState } from 'react'
import Button from '../../shared/ui/Button'
import ExpandableTextInput from '../../shared/ui/ExpandableTextInput'
import Input from '../../shared/ui/Input'
import Select from '../../shared/ui/Select'
import { getEntity, type ArcEntity } from '../../data/persistence'
import { saveChatProposalDraft, type ChatMessageEntity } from './chat-service'
import { proposalDraftFields, proposalDraftValues, type EditableProposal, type EditableProposalField } from './chat-proposal-draft'

export default function ProposalDraftEditor({ message, field, proposal, onSaved }: { message: ChatMessageEntity; field: EditableProposalField; proposal: EditableProposal; onSaved: () => Promise<unknown> }) {
  const { types } = useLoreTypes(message.bookId)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState(() => proposalDraftValues(field, proposal))
  const [revision, setRevision] = useState(proposal.draftRevision ?? 0)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const target = 'entityId' in proposal ? proposal.entityId : undefined
    if (target) void getEntity<ArcEntity>(target).then(entity => {
      if (cancelled) return
      if (!entity || (entity.bookId !== message.bookId && entity.id !== message.bookId)) setSource('Original target is unavailable. Apply will require a refreshed proposal.')
      else if ('expectedUpdatedAt' in proposal && proposal.expectedUpdatedAt !== undefined && entity.updatedAt !== proposal.expectedUpdatedAt) setSource('The source changed after this proposal. Apply will require a refreshed proposal.')
      else setSource(String(entity.content ?? entity.title ?? ''))
    }).catch(() => { if (!cancelled) setSource('Could not load the source.') })
    return () => { cancelled = true }
  }, [open, message.bookId, proposal])
  const fields = proposalDraftFields(field, proposal, types)
  if (proposal.status !== 'proposed' || !fields.length) return null
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await saveChatProposalDraft(message.bookId, message.parentId, message.id, field, proposal.id, values, revision)
      await onSaved()
      setOpen(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the draft.') }
    finally { setBusy(false) }
  }
  return <section className="chat-proposal-draft">
    {!open ? <Button size="small" variant="ghost" onClick={() => { setValues(proposalDraftValues(field, proposal)); setRevision(proposal.draftRevision ?? 0); setError(''); setOpen(true) }}>Edit proposal</Button> : <>
      <p>Save draft keeps your changes in this chat. Use the proposal’s Apply or Create button when ready.</p>
      <div className="chat-proposal-draft-columns">
        <div><strong>Original source / suggestion</strong>{source && <pre>{source}</pre>}{field === 'documentEdits' && 'edits' in proposal && proposal.edits?.map((edit, index) => <pre key={index}>{edit.oldText}</pre>)}<details><summary>Original suggestion</summary><pre>{Object.values(proposal.originalDraft ?? proposalDraftValues(field, proposal)).join('\n\n')}</pre></details></div>
        <div>{fields.map(item => item.options ? <Select key={item.key} label={item.label} disabled={busy} value={values[item.key]} onChange={event => setValues(current => ({ ...current, [item.key]: event.target.value }))}>{!item.options.includes(values[item.key]) && <option value={values[item.key]} disabled>Unavailable type</option>}{item.options.map(value => <option key={value} value={value}>{item.optionLabels?.[value] ?? value}</option>)}</Select> : item.multiline ? <label key={item.key}><span>{item.label}</span><ExpandableTextInput aria-label={item.label} dialogTitle={`Edit ${item.label.toLowerCase()}`} value={values[item.key]} readOnly={busy} onChange={value => setValues(current => ({ ...current, [item.key]: value }))} /></label> : <Input key={item.key} label={item.label} disabled={busy} value={values[item.key]} onChange={event => setValues(current => ({ ...current, [item.key]: event.target.value }))} />)}</div>
      </div>
      {error && <p role="alert">{error}</p>}
      <footer><Button size="small" variant="ghost" disabled={busy} onClick={() => setValues(proposal.originalDraft ?? proposalDraftValues(field, proposal))}>Reset to original</Button><Button size="small" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel editing</Button><Button size="small" variant="primary" loading={busy} onClick={() => { void save() }}>Save draft</Button></footer>
    </>}
  </section>
}
