import IllustrationModal from '../images/IllustrationModal'
import Button from '../../shared/ui/Button'
import type { WorldTriggerConflict } from './world-service'
import '../images/illustrations.css'
import './worlds.css'

export function TriggerConflictsDialog({ title, conflicts, onClose }: {
  title: string
  conflicts: WorldTriggerConflict[]
  onClose: () => void
}) {
  return <IllustrationModal title={title} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
    {conflicts.length ? <>
      <p>Resolve these automatic trigger conflicts in the destination before transferring the entry.</p>
      <ul className="world-trigger-conflicts" aria-label="Trigger conflicts">
        {conflicts.map((conflict, index) => <li key={`${conflict.bookId ?? ''}:${conflict.entryId}:${conflict.trigger}:${index}`}>
          <strong>{conflict.trigger}</strong>
          <span>Codex entry: {conflict.title}</span>
          {(conflict.bookTitle || conflict.bookId) && <span>Book: {conflict.bookTitle ?? conflict.bookId}</span>}
        </li>)}
      </ul>
    </> : <p role="status">No trigger conflicts in the destination.</p>}
  </IllustrationModal>
}

export default TriggerConflictsDialog
