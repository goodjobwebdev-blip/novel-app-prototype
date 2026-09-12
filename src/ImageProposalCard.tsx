import { selectedMediaPrompt } from './media-prompt'
import { useRef, useState } from 'react'
import type { ChatMessageEntity } from './chat-service'
import type { ChatImageProposal } from './image-generation-types'
import { useImageQuery } from './image-hooks'
import ImageGenerationControls, { type ImageDraft } from './ImageGenerationControls'
import IllustrationModal from './IllustrationModal'
import ImageJobs from './ImageResults'
import { enqueueImageProposal, getEntity, listGalleryImages, listImageJobs, saveImageProposalDraft, setImageProposal } from './image-store'
import { generationTaskNames } from './image-settings'
import './image-generation.css'

const proposalDraft = (value: ChatImageProposal): ImageDraft => structuredClone(value.draft ?? { prompt: value.prompt, alias: value.modelAlias, size: value.size, task: value.task ?? 'text-to-image', sources: [] })
export default function ImageProposalCard({ message, proposal }: { message: ChatMessageEntity; proposal: ChatImageProposal }) {
  const { data: current, error: readError } = useImageQuery(() => getEntity<ChatMessageEntity>(message.id), [message.id], message as ChatMessageEntity | undefined)
  const value = current?.imageGenerations?.find(p => p.id === proposal.id) ?? proposal
  const { data: sourceAssets } = useImageQuery(() => listGalleryImages(message.bookId), [message.bookId], [])
  const { data: jobs } = useImageQuery(listImageJobs, [], [])
  const ownedJobs = jobs.filter(job => job.bookId === message.bookId && job.chatId === message.parentId && job.messageId === message.id && job.proposalId === proposal.id && !job.hiddenInChat)
  const [draft, setDraft] = useState<ImageDraft>(() => proposalDraft(value))
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const busyRef = useRef(false)
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve())
  const origin = { bookId: message.bookId, chatId: message.parentId, messageId: message.id, proposalId: value.id }
  const action = async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await fn() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Image action failed.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const changeDraft = (next: ImageDraft) => {
    setDraft(next)
    const save = saveImageProposalDraft(origin, next)
    pendingSave.current = save
    void save.catch(reason => setError(reason instanceof Error ? reason.message : 'Draft could not be saved.'))
  }
  const close = () => { void action(async () => { await pendingSave.current; setExpanded(false) }) }
  const open = () => { void action(async () => {
    await pendingSave.current
    const latest = await getEntity<ChatMessageEntity>(message.id)
    const saved = latest?.imageGenerations?.find(item => item.id === proposal.id)
    if (!saved || !['proposed', 'accepted'].includes(saved.status)) throw new Error('This media proposal is no longer editable.')
    setDraft(proposalDraft(saved)); setExpanded(true)
  }) }
  const generate = async () => {
    await pendingSave.current
    await enqueueImageProposal(draft, { ...origin, submissionId: crypto.randomUUID() })
  }
  const latestJob = ownedJobs.at(-1)
  const active = ownedJobs.filter(job => ['queued', 'running'].includes(job.status))
  return <section className="image-proposal image-ui chat-media-card">
    <header><strong>{generationTaskNames[value.draft?.task ?? value.task ?? 'text-to-image']}</strong><span role="status">{active.length ? `${active.length} queued / generating` : latestJob?.status ?? value.status}</span></header>
    <small>{value.draft?.alias ?? value.modelAlias}</small>
    <p className="image-prompt-preview">{value.draft ? selectedMediaPrompt(value.draft) : value.prompt}</p>
    {['proposed', 'accepted'].includes(value.status) && <button type="button" disabled={busy} onClick={open}>Open generation tool</button>}
    {(error || readError) && <p role="alert">{error || readError}</p>}
    {!expanded && <ImageJobs proposalId={proposal.id} messageId={message.id} />}
    {expanded && <IllustrationModal title="Generation tool" onClose={close} footer={<div className="image-actions">
      <button type="button" disabled={busy} onClick={close}>Close tool</button>
      {value.status === 'proposed' && <button type="button" disabled={busy} onClick={() => { void action(async () => { await pendingSave.current; await setImageProposal(message.id, value.id, 'rejected'); setExpanded(false) }) }}>Reject</button>}
      <button type="button" className="image-primary" disabled={busy || !['proposed', 'accepted'].includes(value.status) || !selectedMediaPrompt(draft).trim()} onClick={() => { void action(generate) }}>{busy ? 'Saving…' : 'Generate'}</button>
    </div>}>
      <div className="image-ui"><ImageGenerationControls bookId={message.bookId} value={draft} onChange={changeDraft} disabled={busy} sourceAssets={sourceAssets} />
      <p className="image-help">Generate approves and queues the shown prompt, model, options, and source images. You can keep editing and queue another generation while earlier requests run.</p>
      {error && <p role="alert">{error}</p>}
      <section className="image-proposal-queue" aria-label="Proposal generation queue">
        <h3>Generation queue</h3>
        {!ownedJobs.length && <p className="image-help">Your queued generations and results will appear here.</p>}
        <ImageJobs proposalId={proposal.id} messageId={message.id} showPrompt />
      </section></div>
    </IllustrationModal>}
  </section>
}
