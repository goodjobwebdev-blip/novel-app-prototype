import { useEffect, useState } from 'react'
import { getBookSyncState, getSyncLink, SYNC_CHANGED, type BookSyncState } from './sync-persistence'
import { getWorldSyncState, WORLD_SYNC_CHANGED } from './world-sync-service'

const labels: Record<BookSyncState['status'], string> = {
  idle: 'Cloud idle', checking: 'Checking cloud', syncing: 'Syncing', synced: 'Synced', 'remote-changed': 'Cloud changed', conflict: 'Sync conflict', offline: 'Sync offline', error: 'Sync failed',
}
type StatusValue = { label: string; state?: BookSyncState['status']; message?: string }
export function useWorkspaceSyncStatus(ownerId?: string, ownerType: 'book' | 'world' = 'book'): StatusValue {
  const [value, setValue] = useState<StatusValue & { ownerId?: string; ownerType?: string }>({ label: '' })
  useEffect(() => {
    let active = true, generation = 0
    async function refresh() {
      const request = ++generation
      try {
        const state = ownerId ? ownerType === 'world' ? await getWorldSyncState(ownerId)
          : await getSyncLink(ownerId) ? await getBookSyncState(ownerId) : undefined : undefined
        if (active && request === generation) setValue({ ownerId, ownerType, ...(state ? { label: labels[state.status], state: state.status, message: state.message } : { label: '' }) })
      } catch (error) {
        if (active && request === generation) setValue({ ownerId, ownerType, label: 'Sync failed', state: 'error', message: error instanceof Error ? error.message : 'Cannot read sync status.' })
      }
    }
    void refresh()
    const changed = (event: Event) => {
      const id = event instanceof CustomEvent ? event.detail?.[ownerType === 'world' ? 'worldId' : 'bookId'] : undefined
      if (!id || id === ownerId) void refresh()
    }
    const event = ownerType === 'world' ? WORLD_SYNC_CHANGED : SYNC_CHANGED
    window.addEventListener(event, changed)
    return () => { active = false; generation++; window.removeEventListener(event, changed) }
  }, [ownerId, ownerType])
  return value.ownerId === ownerId && value.ownerType === ownerType ? value : { label: '' }
}
