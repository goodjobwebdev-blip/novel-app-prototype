import { useState } from 'react'
import type { ChatMessageEntity } from './chat-service'
import type { ChatImageProposal } from './image-generation-types'
import { useImageQuery } from './image-hooks'
import ImageGenerationControls, { type ImageDraft } from './ImageGenerationControls'
import ImageJobs from './ImageResults'
import { enqueueImageJob, getEntity, listGalleryImages, setImageProposal } from './image-store'
import { generationTaskNames, resolveImageSpec } from './image-settings'
import './image-generation.css'
export default function ImageProposalCard({ message, proposal }: { message: ChatMessageEntity; proposal: ChatImageProposal }) {
  const { data: current, error: readError } = useImageQuery(() => getEntity<ChatMessageEntity>(message.id), [message.id], message as ChatMessageEntity | undefined)
  const value = current?.imageGenerations?.find((p) => p.id === proposal.id) ?? proposal
  const { data: sourceAssets } = useImageQuery(() => listGalleryImages(message.bookId), [message.bookId], [])
  const [draft, setDraft] = useState<ImageDraft>({ prompt: value.prompt, alias: value.modelAlias, size: value.size, task: value.task ?? 'text-to-image', sources: [] })
  const [expanded, setExpanded] = useState(value.status === 'proposed'), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Image action failed.') } finally { setBusy(false) } }
  const task = draft.task ?? 'text-to-image'
  const spec = () => resolveImageSpec(draft.prompt, draft.alias, draft.size, undefined, undefined, task, draft.sources ?? [], { resolution: draft.resolution, duration: draft.duration, aspectRatio: draft.aspectRatio, fps: draft.fps, numFrames: draft.numFrames, seed: draft.seed, draft: draft.draftVideo })
  return <section className="image-proposal image-ui"><header><strong>{generationTaskNames[task]}</strong><span>{value.status}</span></header>{['proposed', 'accepted'].includes(value.status) && <><button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Close tool' : 'Open generation tool'}</button>{expanded && <><ImageGenerationControls value={draft} onChange={setDraft} disabled={busy} sourceAssets={sourceAssets} /><div className="image-actions">{value.status === 'proposed' ? <><button type="button" disabled={busy} onClick={() => { void action(() => setImageProposal(message.id, value.id, 'accepted', draft)) }}>Accept proposal</button><button type="button" disabled={busy} onClick={() => { void action(() => setImageProposal(message.id, value.id, 'rejected')) }}>Reject</button></> : <button type="button" disabled={busy} onClick={() => { void action(() => enqueueImageJob(spec(), { bookId: message.bookId, chatId: message.parentId, messageId: message.id, proposalId: value.id })) }}>Generate</button>}</div><p className="image-help">{value.status === 'proposed' ? 'Accepting approves the proposal. Generation starts only when you press Generate.' : 'Each Generate tap queues one immutable request with the current prompt, model, options, and source images.'}</p></>}</>}{(error || readError) && <p role="alert">{error || readError}</p>}<ImageJobs proposalId={proposal.id} messageId={message.id} /></section>
}
