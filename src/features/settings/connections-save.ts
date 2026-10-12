import { database } from '../../data/persistence'
import { AI_SETTINGS_EVENT, AI_SETTINGS_STORAGE_KEY, copyAiSettings, loadAiSettings, type AiSettings } from '../../shared/ai/ai-settings'
import { IMAGE_SETTINGS_CHANGED, IMAGE_SETTINGS_KEY, loadImageSettings, validateImageSettings } from '../images/image-settings'
import type { ImageSettings } from '../images/image-generation-types'

const CONNECTIONS_LOCK = 'arc-global-connections-save'

/** Only synchronous storage work belongs here; never await an application write queue. */
async function withConnectionsLock<T>(commit: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(CONNECTIONS_LOCK, { mode: 'exclusive' }, commit)
  }
  // A real IndexedDB read-write transaction serializes this origin's tabs. Its
  // callback alone does not prove acquisition: wait for a request to complete.
  // Opening/locking failures propagate; there is no unsafe localStorage fallback.
  const db = await database()
  return db.transaction('rw', db.table('meta'), async () => {
    await db.table('meta').get(CONNECTIONS_LOCK)
    return commit()
  })
}

export async function saveConnections(
  draft: { connection: AiSettings; imageKeys: ImageSettings['keys']; baseline: string },
  assertOtherChangesCurrent: () => void,
) {
  const saved = await withConnectionsLock(() => {
    const currentConnection = loadAiSettings(), currentMedia = loadImageSettings()
    if (JSON.stringify({ connection: currentConnection, imageKeys: currentMedia.keys }) !== draft.baseline) {
      throw new Error('Connections changed in another editor. Your draft is retained; Discard to load the latest saved connections before editing again.')
    }
    assertOtherChangesCurrent()
    // Preserve the latest media favorites, not the form's older snapshot.
    const connection = copyAiSettings(draft.connection)
    const media = validateImageSettings({ ...currentMedia, keys: draft.imageKeys })
    const { prompts: _legacyPromptMirror, ...persistedConnection } = connection
    const values = [
      [IMAGE_SETTINGS_KEY, JSON.stringify(media)],
      [AI_SETTINGS_STORAGE_KEY, JSON.stringify(persistedConnection)],
    ] as const
    const previous = values.map(([key]) => [key, localStorage.getItem(key)] as const)
    try {
      for (const [key, value] of values) localStorage.setItem(key, value)
    } catch (failure) {
      // localStorage has no multi-key transaction. Restore either partial write
      // while still holding the lock; do not advance the editor's baseline.
      let restored = true
      for (const [key, value] of previous) {
        try {
          if (localStorage.getItem(key) !== value) {
            if (value === null) localStorage.removeItem(key)
            else localStorage.setItem(key, value)
          }
        } catch { restored = false }
      }
      if (!restored) throw new Error('Connections could not be fully saved or restored. Your draft is retained; Discard to review the saved connections before editing again.')
      throw failure
    }
    return { connection, imageKeys: media.keys }
  })
  // Notify only after both credential stores are written and the lock is released.
  window.dispatchEvent(new Event(IMAGE_SETTINGS_CHANGED))
  window.dispatchEvent(new (window.Event ?? Event)(AI_SETTINGS_EVENT))
  return saved
}
