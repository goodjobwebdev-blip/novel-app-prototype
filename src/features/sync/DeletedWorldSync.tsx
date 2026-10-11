import { useEffect, useState } from 'react'
import { WORLD_ARCHIVE_CHANGED } from '../../data/world-archive'
import WorldSyncPanel from './WorldSyncPanel'
import { listDeletedWorldSyncStates, WORLD_SYNC_CHANGED, type WorldSyncState } from './world-sync-service'
import { SYNC_SETTINGS_EVENT } from './sync-settings'

export type DeletedWorldSyncProps = { onRemoteApplied?: (worldId: string) => Promise<void> }
const noSaveNeeded = async () => {}

/** Library recovery controls: deletion must not remove access to sync errors/conflicts. */
export function DeletedWorldSync({ onRemoteApplied }: DeletedWorldSyncProps = {}) {
  const [states, setStates] = useState<WorldSyncState[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true, version = 0
    async function refresh() {
      const request = ++version
      try {
        const next = await listDeletedWorldSyncStates()
        if (active && request === version) { setStates(next); setError('') }
      } catch (error) {
        if (active && request === version) setError(error instanceof Error ? error.message : 'Cannot read deleted World sync states.')
      }
    }
    const changed = () => { void refresh() }
    void refresh()
    for (const event of [WORLD_ARCHIVE_CHANGED, WORLD_SYNC_CHANGED, SYNC_SETTINGS_EVENT]) window.addEventListener(event, changed)
    return () => { active = false; version++; for (const event of [WORLD_ARCHIVE_CHANGED, WORLD_SYNC_CHANGED, SYNC_SETTINGS_EVENT]) window.removeEventListener(event, changed) }
  }, [])
  if (!states.length && !error) return null
  return <section aria-label="Deleted Worlds cloud sync">
    <h3>Deleted Worlds</h3>
    <p>Deletion tombstones remain connected until you disconnect them. Retry failed uploads or explicitly resolve preserved versions; deleted identities cannot be resurrected.</p>
    {error && <p role="alert">{error}</p>}
    {states.map(state => <div key={state.worldId}>
      <h4>Deleted World · {state.worldId}</h4>
      <WorldSyncPanel worldId={state.worldId} beforeSync={noSaveNeeded} onRemoteApplied={() => onRemoteApplied?.(state.worldId) ?? Promise.resolve()} />
    </div>)}
  </section>
}
export default DeletedWorldSync
