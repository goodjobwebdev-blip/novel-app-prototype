import { useEffect, useState } from 'react'
import { getBookSyncState, getSyncLink, SYNC_CHANGED, type BookSyncState } from './sync-persistence'

const labels: Record<BookSyncState['status'], string> = {
  idle: 'Cloud idle', checking: 'Checking cloud', syncing: 'Syncing', synced: 'Synced', 'remote-changed': 'Cloud changed', conflict: 'Sync conflict', offline: 'Sync offline', error: 'Sync failed',
}

export function useWorkspaceSyncStatus(bookId?: string): { label: string; state?: BookSyncState['status']; message?: string } {
  const [value, setValue] = useState<{ label: string; state?: BookSyncState['status']; message?: string }>({ label: '' })
  useEffect(() => {
    let active = true
    async function refresh() {
      if (!bookId || !await getSyncLink(bookId)) { if (active) setValue({ label: '' }); return }
      const state = await getBookSyncState(bookId)
      if (active) setValue(state ? { label: labels[state.status], state: state.status, message: state.message } : { label: 'Cloud idle', state: 'idle' })
    }
    void refresh()
    const changed = (event: Event) => { if (!(event instanceof CustomEvent) || !event.detail?.bookId || event.detail.bookId === bookId) void refresh() }
    window.addEventListener(SYNC_CHANGED, changed)
    return () => { active = false; window.removeEventListener(SYNC_CHANGED, changed) }
  }, [bookId])
  return value
}
